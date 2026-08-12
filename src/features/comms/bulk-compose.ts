// The bulk email composer, as outbox rows. SPK-13, CRM-11.
//
// The gap this closes: every message bodo could send was bound to a trigger. An organizer
// could rewrite the words of an acceptance or an invitation, and could send an invitation to
// a selection, but there was nowhere to type a subject and a body of their own. So a schedule
// change, a venue note, a "please book your travel" went out of somebody's personal mailbox
// and left no row in Email history.
//
// It is the INVITATION'S mechanics with the body opened up, not a second send path. Rows are
// built here and returned; `enqueueEmails` upserts them on `idempotencyKey`; the drain is
// still the only thing that talks to the provider; and every row lands in the same
// `EmailOutbox` the log reads, so a bulk send appears there per recipient with the subject
// that was actually sent. BUILD_SPEC 5.3.
//
// THE BODY IS HTML, and that is the one place this diverges from `EmailTemplates`. A stored
// template lives in `bodyMarkdown` and is authored in a Textarea for the reasons
// markdown-email.ts sets out at length; this body is not stored anywhere, it is composed once
// and snapshotted into `payloadJson`, so the rich text editor the rest of the admin uses is
// the right control and its output is already the thing an email needs. A template picked as a
// starting point is converted through the same `emailHtmlFromMarkdown` the sender would have
// used, so what the organizer edits is what that template would have mailed.
//
// The body is NOT sanitized on the way through, matching the template path deliberately: an
// organizer can already store raw HTML in `EmailTemplates.bodyMarkdown` and in
// `Forms.confirmationEmailHtml`, so this is not a new capability, and `safeRichHtml` refuses a
// non-absolute URL, which would silently strip the `href="{{portalUrl}}"` link out of every
// template offered here. The untrusted half is the merge VALUES, and those go through
// `renderTemplate`, which escapes every one of them.
//
// Pure, and tested in tests/comms-bulk-compose.test.ts.

import { type BulkRecipient, greetingName } from '@/features/comms/bulk-recipients'
import {
  fieldsUsedBy,
  type MergeContext,
  mergeFields,
  renderSubject,
  renderTemplate,
} from '@/features/comms/templates'
import { idempotencyKeys, type OutboxDraft } from '@/features/comms/triggers'
import type { RecordId } from '@/types/domain'

/** What a composed message can name about the event it is being sent from. */
export type BulkEventContext = {
  readonly name: string
  readonly slug: string
  readonly startsAt?: string
  readonly location?: string
}

/**
 * The merge fields offered in the composer's help text.
 *
 * A SUBSET of what `MergeContext` can carry, and the omissions are the point. A bulk send
 * goes to a roster, and half of it may be people who have never submitted anything, so
 * `submission.*` would fail the render for exactly those people. `task.*` belongs to the task
 * reminder, which builds its own body. `magicLink` is per sign-in and has no meaning here.
 *
 * `speaker.company`, `speaker.lastName`, `event.startsAt` and `event.location` are offered but
 * are not guaranteed: they are blank on some rows, and a blank merge value is one the context
 * cannot supply. `mergeFieldProblems` is what tells the organizer which of their chosen
 * recipients that affects, BEFORE they press send.
 */
export const BULK_MERGE_FIELDS: readonly string[] = [
  'speaker.firstName',
  'speaker.lastName',
  'speaker.email',
  'speaker.company',
  'event.name',
  'event.slug',
  'event.startsAt',
  'event.location',
  'portalUrl',
]

export type BulkComposeInput = {
  readonly eventId: RecordId
  readonly event: BulkEventContext
  readonly recipients: readonly BulkRecipient[]
  readonly subject: string
  readonly bodyHtml: string
  readonly portalUrl: string
  /** One instant for the whole batch, so the send reads as one event in the log. */
  readonly sendAt: string
  /** Discriminates this press from the next one. See `bulkSendId`. */
  readonly sendId: string
}

/**
 * One recipient's merge context.
 *
 * Exported so the preview, the gap report and the rows are all built from the same object:
 * a preview computed from a context assembled separately is a preview that can disagree with
 * the mail, which is the whole thing a preview exists to rule out.
 */
export function bulkMergeContext(
  input: Pick<BulkComposeInput, 'event' | 'portalUrl'>,
  recipient: BulkRecipient,
): MergeContext {
  return {
    speaker: {
      firstName: greetingName(recipient),
      lastName: recipient.lastName,
      email: recipient.email,
      ...(recipient.company === undefined ? {} : { company: recipient.company }),
    },
    event: {
      name: input.event.name,
      slug: input.event.slug,
      ...(input.event.startsAt === undefined ? {} : { startsAt: input.event.startsAt }),
      ...(input.event.location === undefined ? {} : { location: input.event.location }),
    },
    portalUrl: input.portalUrl,
  }
}

export type MergeFieldProblem = {
  readonly field: string
  /** How many of the chosen recipients this field would fail the render for. */
  readonly missingFor: number
  /** False for a field that is not in the merge vocabulary at all, e.g. a typo. */
  readonly known: boolean
}

/**
 * Which merge fields in this draft would throw, and for how many of these recipients.
 *
 * The reason it exists: `renderTemplate` raises `MAIL_MERGE_FIELD_UNKNOWN` on a field the
 * context cannot supply, and it does that per MESSAGE, so one speaker with no company on file
 * takes down a send to forty. That is correct behaviour for a trigger, where a broken merge
 * field is a template bug the organizer must learn about. It is a terrible first experience of
 * a composer, where the same failure means "you typed a field that not everybody has" and the
 * fix is to reword one sentence.
 *
 * So this is checked BEFORE the rows are built and shown in the composer. It asks the real
 * `mergeFields` rather than a list of names, so it cannot drift from what the renderer will
 * do: the field is missing here exactly when the render would have thrown on it.
 */
export function mergeFieldProblems(
  input: Pick<BulkComposeInput, 'event' | 'portalUrl' | 'recipients' | 'subject' | 'bodyHtml'>,
): readonly MergeFieldProblem[] {
  const used = [...new Set([...fieldsUsedBy(input.subject), ...fieldsUsedBy(input.bodyHtml)])]
  if (used.length === 0) return []

  const available = input.recipients.map((recipient) =>
    mergeFields(bulkMergeContext(input, recipient)),
  )
  const vocabulary = new Set(BULK_MERGE_FIELDS)

  return used.flatMap((field) => {
    const missingFor = available.filter((fields) => !fields.has(field)).length
    if (missingFor === 0) return []
    return [{ field, missingFor, known: vocabulary.has(field) }]
  })
}

/**
 * FNV-1a over the composed message. Not a security hash; a short stable fingerprint.
 *
 * Written out rather than reached for from `crypto`, because it has to be SYNCHRONOUS: it
 * runs inside the same pure function that builds the rows, and `crypto.subtle.digest` is a
 * promise, which would make every caller of `bulkEmailRows` async for a checksum.
 */
function fingerprint(value: string): string {
  let hash = 0x81_1c_9d_c5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0
  }
  return hash.toString(36)
}

/**
 * What makes this press different from the next one.
 *
 * The DAY plus a fingerprint of the message, which is `reviewerReminderKey`'s shape and is
 * chosen for the same trade. A composed message is not a trigger: there is no submission and
 * no decision whose timestamp could discriminate a legitimate resend from a double click, so
 * something has to be invented, and the two failures pull in opposite directions.
 *
 *   - Keyed on the message alone, an organizer could never send the same words twice. The
 *     same "please book your travel" three weeks later would queue nothing at all, and the
 *     count would say so, but the mail an organizer meant to send would not go.
 *   - Keyed on the instant, a double press is two identical emails to forty people, which is
 *     the failure that cannot be undone.
 *
 * Per day splits the difference the way the reviewer nudge already does: pressing twice in a
 * morning queues nothing the second time and the result says how many were skipped, while the
 * same message next week is a new message and goes. The residual case is a press either side
 * of midnight, which is documented rather than defended.
 */
export function bulkSendId(input: { subject: string; bodyHtml: string; nowIso: string }): string {
  return `${input.nowIso.slice(0, 10)}:${fingerprint(`${input.subject}\n${input.bodyHtml}`)}`
}

/** One row per recipient, rendered as it will be sent. */
export function bulkEmailRows(input: BulkComposeInput): readonly OutboxDraft[] {
  return input.recipients.map((recipient) => {
    const context = bulkMergeContext(input, recipient)
    return {
      eventId: input.eventId,
      kind: 'cohort.custom' as const,
      toEmail: recipient.email,
      idempotencyKey: idempotencyKeys.cohort(input.sendId, recipient.speakerId),
      // `system` and not `template`, even when the organizer started from one: the body was
      // edited after it was picked, so no stored row can be pointed at as the thing that was
      // sent. The Comms log answering "where do I go to change this" with a template the mail
      // did not come from is worse than it answering "this was composed by hand".
      //
      // It is NOT how Email history labels the row, and that gap is closed rather than
      // explained away. `templateSource` is an Airtable single-select over three options, so
      // there is no `manual` to store here; the log derives it from the `cohort:` namespace on
      // the key above instead (`isCohortKey`, and `EmailLogSource` carries the argument). The
      // column an organizer reads says Hand-composed; the column Airtable stores still says
      // system, which is the honest answer to "which stored body was this".
      templateSource: 'system' as const,
      speakerId: recipient.speakerId,
      sendAt: input.sendAt,
      payload: {
        // Unescaped, like every other subject in this codebase: a subject is a mail header,
        // so "AI & ML Summit" must not arrive as "AI &amp; ML Summit".
        subject: renderSubject(input.subject, context),
        html: renderTemplate(input.bodyHtml, context),
        attachIcs: false,
      },
    }
  })
}
