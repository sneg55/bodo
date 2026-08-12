// The two admin alerts from BUILD_SPEC 5.3: a submission arrived, and a speaker edited one.
//
// One builder for both, because they differ in exactly three things (the trigger kind, the
// idempotency key, and which `Forms` column holds the recipients) and agree on everything
// that is easy to get wrong: per-recipient keys, case-insensitive dedupe, the fallbacks that
// keep a blank name from raising, and now the stored-template lookup. Two copies of that is
// how one of them quietly loses the dedupe.
//
// Like every other trigger this ENQUEUES and returns. Nothing here sends and nothing here
// imports the provider (see the header of @/features/submissions/decision-outbox).
//
// The BODY is resolved through `resolveTemplate`, which is the change these alerts exist to
// carry: the organizer's `EmailTemplates` row wins, the built-in markdown default is the
// fallback, and `templateSource` says which one it was. Before this, both alerts had their
// body concatenated in code and every row was stamped `system` whether or not that was true.

import { emailHtmlFromMarkdown } from '@/features/comms/markdown-email'
import { type CodeTemplate, resolveTemplate } from '@/features/comms/resolve-template'
import { adminTemplateFor, TEMPLATE_KEYS, type TemplateKey } from '@/features/comms/template-keys'
import type { MergeContext } from '@/features/comms/templates'
import { idempotencyKeys, type OutboxDraft } from '@/features/comms/triggers'
import type { EmailTemplate, RecordId } from '@/types/domain'

/** Which of the two alerts. `new` reads `adminAlertOnNew`, `update` `adminAlertOnUpdate`. */
export type AdminAlertKind = 'new' | 'update'

/** Last resort for the actor's label. See `mergeContext` for why one is needed at all. */
const UNNAMED_SPEAKER = 'A speaker'

export type AdminAlertInput = {
  readonly kind: AdminAlertKind
  readonly eventId: RecordId
  readonly eventName: string
  readonly eventSlug: string
  readonly submissionId: RecordId
  readonly submissionTitle: string
  readonly submissionCode: string
  /** The matching `Forms` column. Empty means this trigger is switched off for the form. */
  readonly recipients: readonly string[]
  /** Who caused the alert: the submitter, or the speaker who saved the edit. */
  readonly actor: { readonly name: string; readonly email: string }
  /** The instant of the submit or the save. In the key, and used as `sendAt`. */
  readonly at: string
  /**
   * Where the organizer should land. The merge context section 5.3 fixes has one link slot
   * and calls it `portalUrl`; for an admin alert the useful destination is the submission in
   * the admin app, so that is what goes in it.
   */
  readonly linkUrl: string
  /**
   * The event's `EmailTemplates` row for this alert, or `undefined` when it has none.
   * Absence is the normal state and means the built-in body sends.
   */
  readonly template?: EmailTemplate
}

/** Which template key each alert reads, and therefore which panel row edits it. */
export function adminAlertTemplateKey(kind: AdminAlertKind): TemplateKey {
  return kind === 'new' ? TEMPLATE_KEYS.adminNew : TEMPLATE_KEYS.adminUpdate
}

/**
 * The built-in body and subject, as the template catalogue declares them.
 *
 * Read off `ADMIN_TEMPLATES` rather than written again here, which is the single-source
 * property that makes the panel honest: the markdown an organizer sees prefilled in the
 * editor is the same string the sender falls back to, so "the default" cannot mean two
 * different bodies depending on which side you look from.
 */
function codeTemplate(kind: AdminAlertKind): CodeTemplate {
  const meta = adminTemplateFor(adminAlertTemplateKey(kind))
  if (meta === undefined) {
    // Unreachable: the key comes from the same closed list. Kept as a value rather than a
    // throw so a missing entry degrades to a plain alert instead of losing the notification.
    return { subject: '{{submission.code}}', html: '<p>{{portalUrl}}</p>', attachIcs: false }
  }
  return {
    subject: meta.defaultSubject,
    // Converted once per call. The catalogue stores markdown because that is what the
    // organizer edits; `resolveTemplate` wants the fallback as HTML.
    html: emailHtmlFromMarkdown(meta.defaultBody),
    attachIcs: false,
  }
}

/**
 * The recipient is appended to section 5.3's key, for the same reason `decisionKey` appends
 * the speaker id: an outbox row carries ONE `toEmail` and the enqueue upserts on this column,
 * so a shared key would collapse a three-organizer alert list into one row and two of them
 * would never hear. The rest of the key is unchanged, so two saves at the same instant still
 * collapse to one row per organizer.
 */
function alertKey(input: AdminAlertInput, email: string): string {
  const base =
    input.kind === 'new'
      ? idempotencyKeys.adminNew(input.submissionId)
      : idempotencyKeys.adminUpdate(input.submissionId, input.at)
  return `${base}:${email}`
}

export function adminAlertRows(input: AdminAlertInput): readonly OutboxDraft[] {
  const seen = new Set<string>()

  // Resolved once and snapshotted onto every row, which is what 5.3 wants anyway: the body is
  // the mail as it read at enqueue time, not a reference to be re-rendered later.
  const resolved = resolveTemplate({
    stored: input.template,
    fallback: codeTemplate(input.kind),
    context: mergeContext(input),
  })

  return input.recipients.flatMap((recipient) => {
    // Normalised for the key and for the dedupe, so one organizer listed twice in the column
    // (or once with different capitalisation) is one email.
    const email = recipient.trim().toLowerCase()
    if (email === '' || seen.has(email)) return []
    seen.add(email)

    return [
      {
        eventId: input.eventId,
        kind:
          input.kind === 'new'
            ? ('submission.admin_new' as const)
            : ('submission.admin_update' as const),
        toEmail: email,
        idempotencyKey: alertKey(input, email),
        templateSource: resolved.templateSource,
        // Provenance for the Comms log: which row supplied the body. Absent when the
        // built-in default did, which is what `templateSource: 'system'` already says.
        ...(resolved.templateId === undefined ? {} : { templateId: resolved.templateId }),
        submissionId: input.submissionId,
        // No `speakerId`: the speaker link on an outbox row is the speaker the message is
        // addressed to, and this one is addressed to an organizer who has no Speakers row.
        sendAt: input.at,
        payload: resolved.payload,
      },
    ]
  })
}

/**
 * The two values that can arrive empty carry a fallback, and that is not defensive padding.
 * `renderTemplate` raises on a merge field the context cannot supply and counts an empty
 * string as unsupplied, and these rows are built AFTER the submission has been written: a
 * speaker with a blank name would otherwise turn a landed save into a raised error, and the
 * organizer would still not be told. The event name needs no fallback because the DAL's
 * `text()` mapper already refuses an empty one on the way in.
 */
function mergeContext(input: AdminAlertInput): MergeContext {
  const name = input.actor.name.trim()
  const email = input.actor.email.trim()
  const title = input.submissionTitle.trim()

  return {
    speaker: {
      firstName: name === '' ? (email === '' ? UNNAMED_SPEAKER : email) : name,
      lastName: '',
      email,
    },
    event: { name: input.eventName, slug: input.eventSlug },
    // The code is the fallback title, since it is the handle both sides already use.
    submission: { code: input.submissionCode, title: title === '' ? input.submissionCode : title },
    portalUrl: input.linkUrl,
  }
}
