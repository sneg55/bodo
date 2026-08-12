// Step three: the twelve submissions and their cast.
//
// Field sets are built through `submissionDraftFields` and `participantFields` from
// src/services/airtable/to-fields.ts rather than assembled here, so the seed writes
// the same shape the app writes. A link is an ARRAY even when it holds one id, and a
// seed that got that right by hand would be a second place for the rule to live.
//
// Scheduling is a separate write for the same reason: `scheduleFields` always sends
// room, start and end so that unscheduling can CLEAR them, and reusing it means the
// two placed rows are placed exactly as the agenda builder would place them.

import type { FieldSet } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import {
  contentStatusFields,
  link,
  participantFields,
  scheduleFields,
  submissionDraftFields,
} from '@/services/airtable/to-fields'
import type { Ensured, SeedContext } from './ensure'
import { idFor } from './ensure'
import type { Foundation } from './steps-foundation'
import { SUBMISSIONS, type SubmissionSeed } from './submissions-data'

export type Content = { submissions: Ensured }

/** A submission is keyed on its title within the event. Titles here are distinct. */
export const SUBMISSION_KEY = [COL.event, COL.title] as const

function draftFields(row: SubmissionSeed, formId: string, foundation: Foundation): FieldSet {
  const tagIds = (row.tags ?? []).map((name) =>
    idFor(foundation.tags, [link(foundation.eventId), name], 'tag'),
  )

  return submissionDraftFields({
    eventId: foundation.eventId,
    // A manual row deliberately has no form link, which is also what tells the
    // Source chip to read `Manual` instead of resolving a form name. Section 3.
    formId: row.manual === true ? undefined : formId,
    submitterId: idFor(foundation.speakers, [row.submitter], 'speaker'),
    title: row.title,
    status: row.status,
    source: row.manual === true ? 'manual' : 'form',
    // Stamped at creation from the form's entityKind and never re-derived, so a
    // manual session skips review entirely. Section 5.1b.
    reviewRequired: row.manual !== true,
    answers: { ...row.answers },
    format: row.format,
    trackId: idFor(foundation.tracks, [link(foundation.eventId), row.track], 'track'),
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    submittedAt: row.submittedAt,
  })
}

/**
 * The notify stamp, which `submissionDraftFields` does not carry.
 *
 * It belongs to the Notify step in the app, not to creation, so the draft builder has
 * no parameter for it. Merged in here rather than adding one, because a create path
 * that can stamp `notifiedAt` is a create path that can claim an email was sent.
 */
function withNotified(fields: FieldSet, row: SubmissionSeed): FieldSet {
  if (row.notifiedAt === undefined) return fields
  return { ...fields, [COL.notifiedAt]: row.notifiedAt }
}

/**
 * The content approval column, which `submissionDraftFields` also does not carry, and for
 * the same reason: approving a deck is a chair's act on an existing session, not part of
 * creating one. Merged in through `contentStatusFields` rather than by naming the column
 * here, so the seed writes the shape `setContentStatus` writes.
 *
 * It matters to the seed because it is the second gate on the public agenda, and a fresh base
 * would otherwise have no row in any state the gate acts on: every seeded session would read
 * `not_submitted`, which is deliberately NOT withheld, so the feature would be invisible
 * rather than demonstrated.
 */
function withContentStatus(fields: FieldSet, row: SubmissionSeed): FieldSet {
  if (row.contentStatus === undefined) return fields
  return { ...fields, ...contentStatusFields(row.contentStatus) }
}

async function placeSessions(
  ctx: SeedContext,
  submissions: Ensured,
  foundation: Foundation,
): Promise<number> {
  // Placement is an update, not a create, so it does not go through `ensure`. It is
  // idempotent anyway: writing the same room and the same two instants a second time
  // leaves the row where it already was.
  const placed = SUBMISSIONS.filter((row) => row.placement !== undefined)
  const patches = placed.map((row) => ({
    id: idFor(submissions, [link(foundation.eventId), row.title], 'submission'),
    fields: scheduleFields({
      roomId: idFor(
        foundation.rooms,
        [link(foundation.eventId), row.placement?.room ?? ''],
        'room',
      ),
      startsAt: row.placement?.startsAt,
      endsAt: row.placement?.endsAt,
      scheduleStatus: 'scheduled',
    }),
  }))
  if (patches.length > 0) await ctx.client.updateRecords(TABLES.submissions, patches)
  return patches.length
}

export async function seedContent(
  ctx: SeedContext,
  foundation: Foundation,
  formId: string,
): Promise<Content> {
  const submissions = await ctx.ensure(
    TABLES.submissions,
    SUBMISSION_KEY,
    SUBMISSIONS.map((row) =>
      withContentStatus(withNotified(draftFields(row, formId, foundation), row), row),
    ),
  )

  await ctx.ensure(
    TABLES.submissionParticipants,
    [COL.submission, COL.speaker, COL.role],
    SUBMISSIONS.flatMap((row) =>
      row.participants.map(([email, role], index) =>
        participantFields(
          {
            speakerId: idFor(foundation.speakers, [email], 'speaker'),
            role,
            // Exactly one per submission, and it is the first listed. Section 3.
            isPrimary: index === 0,
            sortOrder: index + 1,
          },
          idFor(submissions, [link(foundation.eventId), row.title], 'submission'),
        ),
      ),
    ),
  )

  await placeSessions(ctx, submissions, foundation)

  return { submissions }
}
