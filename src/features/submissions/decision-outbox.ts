// Notify writes EmailOutbox rows and returns. It never calls the provider.
//
// BUILD_SPEC 5.3 is emphatic that there is one lifecycle and no second path: "Nothing
// sends email inline. Every trigger writes EmailOutbox rows and returns; the sender is
// the only thing that talks to the provider." An earlier draft of that spec said both
// "changing a status sends the email" and "notification is a separate queue action", and
// the ambiguity is exactly where double-sends live. So nothing here imports `sendEmail`,
// and `features/comms/drain.ts` drains what this writes.
//
// Everything that can be shared with the comms layer is shared rather than reimplemented:
// the idempotency keys come from `features/comms/triggers.ts`, the row shape is its
// `OutboxDraft`, the recipient dedupe is its `recipientsForDecision`, and the bodies go
// through `features/comms/templates.ts`. Two copies of an idempotency key is not a
// duplication smell, it is a duplicate email.
//
// It now DOES read `EmailTemplates`, through `resolveTemplate`, and the note that used to
// stand here (no DAL reader, so every body is a system default and every row is stamped
// `templateSource: 'system'`) is what changed. The bodies below are the fallbacks: the
// event's `accepted` or `rejected` row wins when it has one, the label becomes `template`
// with a `templateId`, and nothing else here is different. `decisions.ts` is what loads the
// row, because a body must not be a read this pure function performs.
//
// The write goes through the DAL's `enqueueEmails`. This file used to spell EmailOutbox's
// columns itself and upsert them directly, on the stated grounds that the DAL had no
// writer for that table. It has one, and the local version was not merely redundant: see
// `enqueueOutbox` below for what it got wrong.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { emailHtmlFromMarkdown } from '@/features/comms/markdown-email'
import {
  type CodeTemplate,
  type ResolvedTemplate,
  resolveTemplate,
} from '@/features/comms/resolve-template'
import { SPEAKER_TEMPLATES, TEMPLATE_KEYS, type TemplateKey } from '@/features/comms/template-keys'
import type { MergeContext } from '@/features/comms/templates'
import { idempotencyKeys, type OutboxDraft, recipientsForDecision } from '@/features/comms/triggers'
import type { QueueDecision } from '@/features/submissions/transitions'
import { enqueueEmails } from '@/services/airtable/mutations-outbox'
import type { EmailTemplate, RecordId } from '@/types/domain'

export type DecisionRecipient = {
  readonly speakerId: RecordId
  readonly email: string
  readonly firstName: string
  readonly lastName: string
}

/**
 * The default bodies. Still `{{path}}` templates, so they go through the same interpolator,
 * the same context and the same escaping as an organizer-authored template: a body
 * assembled with string concatenation here would be the one email in the system whose merge
 * fields were not validated and whose values were not escaped.
 *
 * They are no longer written here, and that is what made these two templates editable. The
 * text lives in `SPEAKER_TEMPLATES` (features/comms/template-keys.ts) as markdown, and
 * Settings > Email Templates prefills its editor with the same string, so the box an
 * organizer types into holds the email their speakers are actually receiving. A second copy
 * in this file would drift, and nothing would report it: the save would succeed and the mail
 * would keep using whichever body the sender happened to hold.
 *
 * Converted at module scope, which is two `marked` calls for the life of the isolate rather
 * than two per recipient. Constants, not a memo table: module-level MUTABLE state used as a
 * cache is what the Workers rules forbid, and these are as immutable as the strings they
 * replaced.
 */
const ACCEPTED = builtIn(TEMPLATE_KEYS.accepted)
const DECLINED = builtIn(TEMPLATE_KEYS.rejected)

function builtIn(key: TemplateKey): CodeTemplate {
  const meta = SPEAKER_TEMPLATES.find((entry) => entry.key === key)
  if (meta === undefined) {
    throw new AppError(ErrorIds.MAIL_TEMPLATE_MISSING, 'no built-in body for this key', { key })
  }
  return {
    subject: meta.defaultSubject,
    html: emailHtmlFromMarkdown(meta.defaultBody),
    attachIcs: false,
  }
}

export type DecisionContext = {
  readonly decision: QueueDecision
  readonly context: MergeContext
  /**
   * The event's `EmailTemplates` row for this decision, when it has one. Optional so a
   * caller that has not loaded it still sends the built-in body: an acceptance the speaker
   * never receives is worse than a generic one.
   */
  readonly template?: EmailTemplate
}

/**
 * The message, and which body it came from.
 *
 * Returns the resolution rather than a bare payload because the CALLER has to record which
 * of the two was used: `templateSource` and `templateId` go onto the outbox row, and a label
 * set anywhere other than where the body was chosen is a label that can disagree with the
 * mail (@/features/comms/resolve-template).
 */
export function renderDecision({ decision, context, template }: DecisionContext): ResolvedTemplate {
  return resolveTemplate({
    stored: template,
    context,
    // The subject now carries `{{event.name}}` where it used to be interpolated here, and
    // that is safe rather than a regression: `renderSubject` substitutes WITHOUT escaping
    // (templates.ts), so "AI & ML Summit" still arrives intact, which is the whole reason
    // the old comment gave for building it as a template literal. It has to be a merge field
    // now, because the same string is what the editor shows as the default subject.
    fallback: decision === 'accept' ? ACCEPTED : DECLINED,
  })
}

export type DecisionEnqueueInput = {
  readonly eventId: RecordId
  readonly eventName: string
  readonly eventSlug: string
  readonly submissionId: RecordId
  readonly submissionTitle: string
  readonly submissionCode: string
  readonly decision: QueueDecision
  /**
   * For an accept this is every `SubmissionParticipants` row, because 5.3 says "each
   * participant" and a co-speaker gets their own email. For a decline it is the submitter
   * alone: telling a co-presenter their colleague's talk was rejected is not the
   * organizer's message to send.
   */
  readonly recipients: readonly DecisionRecipient[]
  /** The instant this press will stamp on the row. Used for `sendAt`, NOT for the key. */
  readonly notifiedAt: string
  /**
   * The submission's CURRENTLY STORED `notifiedAt`, or `'first'` when it has never been
   * notified. This, not the new instant, is what discriminates the idempotency key. See
   * `decisionKey`.
   */
  readonly keyEpoch: string
  readonly portalUrl: string
  /**
   * The event's `EmailTemplates[key=accepted]` or `[key=rejected]` row, when it has one.
   * Loaded by the action (decisions.ts) and passed in, so this stays a pure function: a
   * body that depended on a read here could not be tested without a base.
   */
  readonly template?: EmailTemplate
}

/**
 * The speaker id is appended to the trigger's key, and that needs saying out loud because
 * it departs from the table in 5.3.
 *
 * That table gives `accepted:<submissionId>:<notifiedAt>` while the same section says the
 * recipient is "each participant". Both cannot hold: `EmailOutbox.toEmail` and its
 * `speaker` link are single-valued, and the enqueue upserts on `idempotencyKey`, so one
 * key per submission means a three-speaker session produces one row and two people are
 * never told. Per-recipient keys keep the property the key exists for (a repeated Notify
 * writes no new rows) and deliver to everyone the spec says to deliver to.
 *
 * The time component is the epoch being SUPERSEDED, not the one being written, and that
 * is the second departure from 5.3's table. Using the new instant looked right and had a
 * duplicate-email path in it: mail is enqueued before the status write on purpose, so a
 * row whose mail queued and whose status write then failed still reads as staged. Pressing
 * Notify again took a fresh clock reading, produced different keys, and enqueued a second
 * copy of every message. Resend's idempotency key cannot collapse those, because the keys
 * genuinely differ.
 *
 * Keying on the stored value fixes it without another write, because that value only
 * changes when a notification actually commits:
 *
 *   - Never notified, so `'first'`. A retry reads `'first'` again, computes the same key,
 *     and the enqueue's existing-key check drops it.
 *   - Notified at T1, then reversed and re-staged. The row still holds T1, so the key is
 *     `...:T1:...` and differs from the first press. A genuinely new decision still sends,
 *     which is the property 5.3 wanted the timestamp for.
 *   - Notified at T1, then T2, then reversed again. The row holds T2, so the key differs
 *     from both earlier presses.
 */
function decisionKey(input: DecisionEnqueueInput, speakerId: RecordId): string {
  return input.decision === 'accept'
    ? idempotencyKeys.accepted(input.submissionId, input.keyEpoch, speakerId)
    : idempotencyKeys.declined(input.submissionId, input.keyEpoch, speakerId)
}

/**
 * What to call the recipient, never an empty string.
 *
 * A speaker with no first name used to fail the render and take the whole Notify batch
 * with it. The chain: `mapSpeaker` stores an absent first name as `''`
 * (mapping.ts), `mergeFields` deliberately does not put an empty value into the merge
 * map, and `renderTemplate` then reports `{{speaker.firstName}}` as a field the context
 * cannot supply and throws MAIL_MERGE_FIELD_UNKNOWN.
 *
 * That throw-on-missing rule is right and stays: it is what stops an organizer sending
 * four hundred emails addressed to nobody because of a typo in a merge field. The defect
 * was upstream, in treating "this record has no value" as "this field does not exist".
 * A system email that must reach every accepted speaker cannot depend on a column
 * BUILD_SPEC 3 does not require, so the greeting degrades instead: last name, then a
 * neutral salutation. Only the salutation wording is invented, and no parity doc covers
 * a system email body.
 */
function greetingName(recipient: DecisionRecipient): string {
  const first = recipient.firstName.trim()
  if (first !== '') return first
  const last = recipient.lastName.trim()
  if (last !== '') return last
  return 'there'
}

export function decisionOutboxRows(input: DecisionEnqueueInput): readonly OutboxDraft[] {
  const kind = input.decision === 'accept' ? 'decision.accepted' : 'decision.declined'
  const byEmail = new Map(input.recipients.map((recipient) => [recipient.speakerId, recipient]))

  // Deduplicated through the comms helper, so one person listed twice on a submission
  // (speaker and moderator) is one email rather than two identical ones.
  return recipientsForDecision(input.recipients).flatMap((deduped) => {
    const recipient = byEmail.get(deduped.speakerId)
    if (recipient === undefined) return []

    // Resolved per recipient, because the greeting differs per recipient. The stored row is
    // the same for all of them, so `templateSource` is too.
    const resolved = renderDecision({
      decision: input.decision,
      template: input.template,
      context: {
        speaker: {
          firstName: greetingName(recipient),
          lastName: recipient.lastName,
          email: recipient.email,
        },
        event: { name: input.eventName, slug: input.eventSlug },
        submission: { code: input.submissionCode, title: input.submissionTitle },
        portalUrl: input.portalUrl,
      },
    })

    return [
      {
        eventId: input.eventId,
        kind,
        toEmail: recipient.email,
        idempotencyKey: decisionKey(input, recipient.speakerId),
        // Taken from the resolution, never asserted here. This line used to be a hardcoded
        // `'system'`, which was true only because there was no reader for the table.
        templateSource: resolved.templateSource,
        ...(resolved.templateId === undefined ? {} : { templateId: resolved.templateId }),
        speakerId: recipient.speakerId,
        submissionId: input.submissionId,
        sendAt: input.notifiedAt,
        payload: resolved.payload,
      },
    ]
  })
}

/**
 * Write the rows, through the DAL's writer rather than a second implementation.
 *
 * This used to build its own field set and call `upsertRecords` directly, which was a
 * blind upsert: the field set carried `status: 'queued'` and `attempts: 0`, so writing a
 * key whose row had ALREADY been sent reset it to queued and the drain sent it again.
 * Nothing protected against that except the accident that decision keys embed
 * `notifiedAt`, which is fresh per Notify press. Any caller whose key is stable across
 * runs, which is exactly what a reminder sweep has, would have resent on every sweep.
 * Two independent reviews found this, so it is not a theoretical objection.
 *
 * `enqueueEmails` is the version that was written to prevent it: it reads
 * `existingOutboxKeys` first and only writes rows that are genuinely new. It also expires
 * the event's outbox tag, which the local version did not, so rows queued here used to
 * leave the Comms screen showing a stale list.
 *
 * The idempotency guarantee is unchanged and is still the point: a Notify pressed twice
 * produces one email per recipient. It is now enforced by a read-then-write instead of by
 * an upsert that also resurrects finished rows.
 *
 * `'action'` because both callers are Server Actions (`notifyQueuedAction` and the portal
 * body save). The origin no longer selects between invalidation APIs; see invalidate.ts.
 */
export async function enqueueOutbox(rows: readonly OutboxDraft[]): Promise<number> {
  const { queued } = await enqueueEmails(rows, 'action')
  return queued
}
