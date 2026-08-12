// The reminder sweep: queue what has come due, then send what is queued.
//
// One implementation, two entries. The Cron Trigger reaches it through
// `/api/cron/reminders` (src/entrypoints/worker.ts) and the admin "run now" button will
// reach the same route, which is what BUILD_SPEC 5.3 asks for: a schedule and a button
// that cannot drift apart because there is only one function.
//
// Dependencies are arguments here for the same reason they are in
// `features/comms/drain.ts`: the interesting cases are interleavings between two sweeps
// five minutes apart, and an implementation that reached for the DAL and the clock itself
// could only be tested by running the cron.
//
// Two orderings in this file are load-bearing:
//
//   1. Enqueue BEFORE drain. A reminder that became due since the last sweep is sent in
//      the same run instead of waiting another five minutes, which matters most at the
//      24 hour reminder, where five minutes of slack is the difference between "closes
//      tomorrow" and a deadline the speaker has already missed.
//   2. The enqueue half cannot fail the drain half. They read different tables and fail
//      for different reasons, so a rate-limited Forms read must not strand acceptance
//      mail that is already queued. Its failure is reported in the result instead.

import { isAppError } from '@/constants/errorIds'
import type { SubmissionStatus } from '@/constants/status'
import { type DrainDeps, type DrainResult, drainOutbox } from '@/features/comms/drain'
import { type ResolvedTemplate, resolveTemplate } from '@/features/comms/resolve-template'
import type { MergeContext } from '@/features/comms/templates'
import { draftReminderTimes, idempotencyKeys, type OutboxDraft } from '@/features/comms/triggers'
import type { EmailTemplate, RecordId } from '@/types/domain'
import type { Form } from '@/types/forms'

/** What the sweep needs to know about a form. `closeDate` is what enables reminders. */
export type ReminderForm = Pick<Form, 'id' | 'closeDate'>

/**
 * One unsubmitted submission and the person to nudge.
 *
 * Flattened rather than a `SubmissionWithParticipants`, because the reminder goes to the
 * draft owner alone: 5.3 fans out to every participant for a decision and an invite, and
 * names the "draft owner" for this one. A co-speaker on a draft somebody else is still
 * writing has nothing to act on.
 */
export type DraftForReminder = {
  submissionId: RecordId
  /** Absent for a manually created submission, which has no form and no deadline. */
  formId?: RecordId
  status: SubmissionStatus
  speakerId: RecordId
  toEmail: string
  firstName: string
  code: string
  title: string
}

export type DraftReminderInput = {
  eventId: RecordId
  eventName: string
  eventSlug: string
  portalUrl: string
  nowMs: number
  forms: readonly ReminderForm[]
  drafts: readonly DraftForReminder[]
  /** `EmailTemplates[key=reminder]`, when the event has one. Loaded by ./reminders-wiring. */
  template?: EmailTemplate
}

/** How the two offsets read to a speaker. Section 5.3 fixes the offsets themselves. */
const OFFSET_LABELS = new Map<number, string>([
  [72, 'three days'],
  [24, '24 hours'],
])

function offsetLabel(hoursBefore: number): string {
  // A Map rather than an object literal indexed by the number: a dynamic property read is
  // the injection sink the security lint objects to, and this one comes from data.
  return OFFSET_LABELS.get(hoursBefore) ?? `${String(hoursBefore)} hours`
}

/**
 * The FALLBACK body, as a `{{path}}` template so it goes through the same interpolator,
 * context and escaping as an organizer-authored one. 5.3 sources this reminder from
 * `EmailTemplates[key=reminder]` and it now does: a stored row wins through
 * `resolveTemplate`, and `templateSource` records which body a row actually carried rather
 * than asserting `system` the way it had to while the table had no DAL reader.
 */
function reminderBody(label: string): string {
  return [
    '<p>Hi {{speaker.firstName}},</p>',
    `<p>Your submission <strong>{{submission.title}}</strong> ({{submission.code}}) for {{event.name}} is still a draft, and the form closes in ${label}.</p>`,
    '<p>Open your speaker portal to finish it and submit.</p>',
    '<p><a href="{{portalUrl}}">{{portalUrl}}</a></p>',
  ].join('')
}

/**
 * `renderTemplate` treats an empty merge value as one the context cannot supply and
 * throws, so a Speakers row with a blank first name would otherwise take down every
 * reminder in the sweep rather than its own.
 */
function greetingName(firstName: string): string {
  return firstName.trim() === '' ? 'there' : firstName
}

/**
 * The message AND which body it came from, because the row has to record that: a
 * `templateSource` set anywhere but where the body was chosen can disagree with the mail.
 */
function reminderMessage(
  input: DraftReminderInput,
  draft: DraftForReminder,
  hoursBefore: number,
): ResolvedTemplate {
  const label = offsetLabel(hoursBefore)
  const context: MergeContext = {
    speaker: { firstName: greetingName(draft.firstName), lastName: '', email: draft.toEmail },
    event: { name: input.eventName, slug: input.eventSlug },
    submission: { code: draft.code, title: draft.title },
    portalUrl: input.portalUrl,
  }

  return resolveTemplate({
    // A stored body cannot carry the offset label, which is per reminder rather than per
    // event, so an organizer writing their own words the deadline themselves. Their trade.
    stored: input.template,
    context,
    fallback: {
      // No merge field, so it reads the same through `renderSubject` as it did through a
      // template literal, and for the same reason it was one: a subject is a mail header, not
      // markup, so "AI & ML Summit" must not arrive as "AI &amp; ML Summit".
      subject: `Reminder: your ${input.eventName} submission closes in ${label}`,
      html: reminderBody(label),
      attachIcs: false,
    },
  })
}

function reminderRow(args: {
  input: DraftReminderInput
  draft: DraftForReminder
  closeDate: string
  hoursBefore: number
  sendAt: string
}): OutboxDraft {
  const message = reminderMessage(args.input, args.draft, args.hoursBefore)
  return {
    eventId: args.input.eventId,
    kind: 'submission.draft_reminder',
    toEmail: args.draft.toEmail,
    idempotencyKey: idempotencyKeys.draftReminder(
      args.draft.submissionId,
      args.closeDate,
      args.hoursBefore,
    ),
    templateSource: message.templateSource,
    ...(message.templateId === undefined ? {} : { templateId: message.templateId }),
    formId: args.draft.formId,
    speakerId: args.draft.speakerId,
    submissionId: args.draft.submissionId,
    // The reminder instant, not now. The Comms log and the due-list both order on this,
    // and stamping it "now" would make a backlog look like it was queued on time.
    sendAt: args.sendAt,
    payload: message.payload,
  }
}

/**
 * The reminder rows that are due, given the drafts and their forms' close dates.
 *
 * `draftReminderTimes` deliberately returns instants in the past as well as the future,
 * because a deadline moved closer can leave a reminder already due. Filtering is the
 * caller's job and this is the caller: a future `sendAt` is dropped rather than queued,
 * so the 24 hour reminder does not go out two days early.
 */
export function draftReminderRows(input: DraftReminderInput): readonly OutboxDraft[] {
  const closeDates = new Map(
    input.forms.flatMap((form) =>
      form.closeDate === undefined ? [] : [[form.id, form.closeDate] as const],
    ),
  )

  return input.drafts.flatMap((draft) => {
    // A submission that has left `draft` since the last sweep is done being nudged, and
    // this check is the whole reason the sweep re-reads status instead of trusting the
    // row it queued five minutes ago.
    if (draft.status !== 'draft') return []

    const closeDate = draft.formId === undefined ? undefined : closeDates.get(draft.formId)
    if (closeDate === undefined) return []

    return draftReminderTimes(closeDate).flatMap(({ hoursBefore, sendAt }) =>
      Date.parse(sendAt) > input.nowMs
        ? []
        : [reminderRow({ input, draft, closeDate, hoursBefore, sendAt })],
    )
  })
}

export type EnqueueCount = { queued: number; skipped: number }

export type ReminderEnqueueDeps = {
  eventId: RecordId
  portalUrl: string
  nowMs: number
  loadEvent: () => Promise<{ name: string; slug: string }>
  listForms: () => Promise<readonly ReminderForm[]>
  /** Every submission the sweep should consider. Status is re-read, never assumed. */
  listDrafts: () => Promise<readonly DraftForReminder[]>
  /** Upserts on `idempotencyKey`, so a repeated sweep writes nothing. */
  enqueue: (rows: readonly OutboxDraft[]) => Promise<EnqueueCount>
  /** `EmailTemplates[key=reminder]`, or nothing when the event has no row. */
  loadTemplate?: () => Promise<EmailTemplate | undefined>
}

/**
 * Queue the due reminders.
 *
 * Nothing here tracks what it has already sent, and it does not need to: the key from
 * `idempotencyKeys.draftReminder` is a function of the submission, the close date and the
 * offset, so the twelfth sweep of the hour computes the same key as the first and the
 * enqueue recognises it. Moving the close date changes the key, which is what re-arms a
 * reminder instead of suppressing it forever.
 */
export async function enqueueDraftReminders(deps: ReminderEnqueueDeps): Promise<EnqueueCount> {
  const [event, forms, drafts, template] = await Promise.all([
    deps.loadEvent(),
    deps.listForms(),
    deps.listDrafts(),
    // Batched with the rest: four independent cached reads. Absent sends the built-in body.
    deps.loadTemplate?.() ?? Promise.resolve(undefined),
  ])

  const rows = draftReminderRows({
    eventId: deps.eventId,
    eventName: event.name,
    eventSlug: event.slug,
    portalUrl: deps.portalUrl,
    nowMs: deps.nowMs,
    forms,
    drafts,
    template,
  })

  // No write at all when nothing is due, which is the normal case on most sweeps.
  if (rows.length === 0) return { queued: 0, skipped: 0 }
  return await deps.enqueue(rows)
}
