// The producer for `session.invite`: the step that turns a schedule change into mail.
//
// Everything downstream of this already existed and none of it ran. `ics.ts` builds
// RFC 5545 content and is unit tested, `invite-attachment.ts` attaches it at send time,
// the drain passes `attachIcs` through, both provider adapters base64-encode it, and
// `triggers.ts` declares the kind and the two idempotency keys. What was missing was
// anything that ever wrote such a row: `session.invite` appeared only in a type union and
// two comments, every `attachIcs:` in the codebase was the literal `false`, and
// `calendarUid` was read in four places and written in none. So the R3 acceptance
// criterion, a .ics landing as a real calendar event, could not be met by any sequence of
// clicks. Found by scheduling and publishing a real session and watching the outbox
// enqueue nothing.
//
// Two decisions worth stating.
//
// The body is the ACCEPTED template, per the §5.3 trigger table, rather than a system
// body of its own. An organizer who has written "see you in Room 2" gets that text on the
// invite too, and there is one place to edit it.
//
// The row is enqueued AFTER the schedule write, which is the opposite of the decision
// mail. The invite is built from the submission record at send time (invite-attachment.ts
// says why), so a row queued before the write would be read by a drain that ran in
// between and would carry the OLD time under the NEW sequence: an update that tells every
// speaker nothing changed. A write that succeeds and an enqueue that fails is the safe
// half of the pair, because scheduling again re-enqueues it.

import type { CalendarPlan } from '@/features/agenda/calendar-plan'
import { idempotencyKeys, type OutboxDraft } from '@/features/comms/triggers'
import { renderDecision } from '@/features/submissions/decision-outbox'
import type { EmailTemplate, SubmissionWithParticipants } from '@/types/domain'

export type InviteRowsInput = {
  readonly eventId: string
  readonly eventName: string
  readonly eventSlug: string
  readonly submission: SubmissionWithParticipants
  readonly plan: Extract<CalendarPlan, { action: 'invite' | 'cancel' }>
  /** The event's `accepted` template, when it has one. Absent sends the built-in body. */
  readonly template?: EmailTemplate
  readonly portalUrl: string
  readonly sendAt: string
  /**
   * The slot being cancelled, for a `cancel` plan only: the last one that was sent, which
   * is what the speaker's calendar is holding. Required there because the schedule write
   * has already cleared the record's times; see `outboxPayloadSchema`.
   */
  readonly cancelledSlot?: { startsAt: string; endsAt: string; room?: string }
}

/**
 * One row per participant, keyed on the sequence.
 *
 * Per participant and not per submission, and the key ends in the speaker id, because an
 * outbox row carries one `toEmail` and `enqueueEmails` upserts on the key: a
 * submission-scoped key would collapse a three-speaker session into one row and put two
 * of the three on nobody's calendar. §5.3 says this in its own words and says an earlier
 * draft of the table got it wrong.
 */
export function calendarInviteRows(input: InviteRowsInput): readonly OutboxDraft[] {
  const { plan, submission } = input
  const seen = new Set<string>()

  return submission.participants.flatMap((participant) => {
    // One person listed twice on a session (speaker and moderator) is one invite.
    if (seen.has(participant.speakerId)) return []
    seen.add(participant.speakerId)

    const speaker = participant.speaker
    const resolved = renderDecision({
      decision: 'accept',
      template: input.template,
      context: {
        speaker: { firstName: greeting(speaker), lastName: speaker.lastName, email: speaker.email },
        event: { name: input.eventName, slug: input.eventSlug },
        submission: { code: submission.code, title: submission.title },
        portalUrl: input.portalUrl,
      },
    })

    return [
      {
        eventId: input.eventId,
        kind: 'session.invite' as const,
        toEmail: speaker.email,
        idempotencyKey:
          plan.action === 'cancel'
            ? idempotencyKeys.cancel(submission.id, plan.sequence, participant.speakerId)
            : idempotencyKeys.invite(submission.id, plan.sequence, participant.speakerId),
        templateSource: resolved.templateSource,
        ...(resolved.templateId === undefined ? {} : { templateId: resolved.templateId }),
        speakerId: participant.speakerId,
        submissionId: submission.id,
        sendAt: input.sendAt,
        payload: {
          ...resolved.payload,
          // The one place in the codebase that sets this true. `resolve-template.ts`
          // refuses to honour a stored `attachIcs` for any other trigger, and says why:
          // a row that asks for an invite and has no scheduled time is a permanent
          // MAIL_ICS_INVALID, so a ticked box on an `accepted` template would kill the
          // acceptance mail. This row has a scheduled time by construction.
          attachIcs: true,
          // Named for what it is once it lands, since the acceptance subject reads oddly
          // on a cancellation.
          subject:
            plan.action === 'cancel' ? `Cancelled: ${submission.title}` : resolved.payload.subject,
          // Only on a cancellation, and only ever read there. See the field's own note.
          ...(plan.action === 'cancel' && input.cancelledSlot !== undefined
            ? { cancelledSlot: input.cancelledSlot }
            : {}),
        },
      },
    ]
  })
}

/**
 * The same degradation as the decision mail: first name, then last, then a neutral word.
 *
 * `renderTemplate` treats an empty merge value as a field the context cannot supply and
 * throws, which is the right rule and is also how one speaker with no first name used to
 * take a whole batch down with them. A calendar invite must not depend on a column
 * BUILD_SPEC 3 does not require.
 */
function greeting(speaker: { firstName: string; lastName: string }): string {
  const first = speaker.firstName.trim()
  if (first !== '') return first
  const last = speaker.lastName.trim()
  if (last !== '') return last
  return 'there'
}
