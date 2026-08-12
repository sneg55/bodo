// The two phases that write submissions: the records themselves, then their placement.
//
// Split from phases.ts, which holds the first two phases and the phase vocabulary, for the
// 300-line ceiling and along the seam that was already there: everything here needs the
// cast and the room-and-track resolution, and nothing in phases.ts does. The dependency
// order it belongs to is still IMPORT_PHASES, and it is stated in phases.ts.
//
// The idempotency rule is that file's too, and it applies here unchanged: a remote id that
// resolves through the ledger is an UPDATE, a miss is a CREATE, nothing is ever deleted.

import type { NormalizedSubmission } from '@/features/imports/normalize'
import type { PhaseContext, PhaseOutcome } from '@/features/imports/phases'
import { importCount } from '@/features/imports/ports'
import type { ParticipantDraft } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'

function castOf(submission: NormalizedSubmission, ctx: PhaseContext): readonly ParticipantDraft[] {
  return submission.participants.flatMap((participant) => {
    const speakerId = ctx.ledger.localIdFor('speaker', participant.speakerRemoteId)
    // A participant whose speaker never landed points at nothing bodo can link.
    if (speakerId === undefined) return []
    return [
      {
        speakerId,
        role: participant.role,
        isPrimary: participant.isPrimary,
        sortOrder: participant.sortOrder,
      },
    ]
  })
}

/**
 * Submissions and their cast.
 *
 * A submission bodo can create needs a SUBMITTER, and that is a required link on the row.
 * A session whose whole cast failed to resolve therefore cannot be written, and is counted
 * as skipped rather than dropped in silence. Sessionize's service sessions (`Lunch` and
 * friends) are that shape by definition, since they carry no speaker at all, so they are
 * counted the same way: bodo has no agenda row that exists without a session behind it.
 */
export async function runSubmissionsPhase(ctx: PhaseContext): Promise<PhaseOutcome> {
  let created = 0
  let updated = 0
  // Seeded with what the mapper already refused: the round-trip skips, plus the service
  // sessions above. Both are visible numbers rather than silent subtractions.
  let skipped = ctx.normalized.skipped.submissions + ctx.normalized.agendaItems.length
  let participants = 0

  for (const submission of ctx.normalized.submissions) {
    const body = bodyOf(submission, ctx)
    // Built for BOTH branches now. It used to be built after the update branch had already
    // `continue`d, so a remote session that gained or changed a speaker kept its old
    // SubmissionParticipants rows forever and the re-run reported nothing amiss.
    const cast = castOf(submission, ctx)

    const held = ctx.ledger.localIdFor('submission', submission.remoteId)
    if (held !== undefined) {
      await ctx.write.updateSubmission({ ...body, submissionId: held })
      // Additive only, per §5.0e: new names get a row, departed ones keep theirs. The port
      // doc in ports.ts carries the argument for why removal is not inferred.
      participants += await ctx.write.addParticipants({
        submissionId: held,
        eventId: ctx.eventId,
        participants: cast,
      })
      updated += 1
      continue
    }

    const submitter = cast.find((member) => member.isPrimary) ?? cast.at(0)
    if (submitter === undefined) {
      skipped += 1
      continue
    }

    const id = await ctx.write.createSubmission({
      draft: {
        ...body,
        submitterId: submitter.speakerId,
        status: submission.status,
        // `manual` because it came through no bodo form, and there is no third value.
        // Inventing an `import` source would break every filter that already exists.
        source: 'manual',
        // Taken from the source where the source states it, never inferred from status.
        reviewRequired: submission.reviewRequired,
        // Nothing imported has form answers, because no bodo form was ever filled in.
        answers: {},
      },
      participants: cast,
    })
    // `none`: `createSubmission` creates unconditionally, and Airtable has no uniqueness
    // constraint on a title, so a mapping lost after this line is a duplicate session with
    // a duplicate cast on the next invocation. Written before the participants are counted
    // for that reason. See `MappingDedupe`.
    await ctx.ledger.record('submission', submission.remoteId, id, 'none')
    participants += cast.length
    created += 1
  }

  await ctx.ledger.flush()
  return {
    counts: {
      submission: importCount(created, updated, skipped),
      participant: importCount(participants, 0),
    },
  }
}

/** The typed columns an import owns. Never `answers`: see `updateSubmission` in ports.ts. */
function bodyOf(submission: NormalizedSubmission, ctx: PhaseContext) {
  return {
    eventId: ctx.eventId,
    title: submission.title,
    format: submission.format,
    level: submission.level,
    language: submission.language,
    trackId: resolve(ctx, 'track', submission.trackRemoteId),
    tagIds: submission.tagRemoteIds.flatMap(
      (remoteId) => ctx.ledger.localIdFor('tag', remoteId) ?? [],
    ),
  }
}

function resolve(
  ctx: PhaseContext,
  entityType: 'track' | 'room',
  remoteId: string | undefined,
): RecordId | undefined {
  return remoteId === undefined ? undefined : ctx.ledger.localIdFor(entityType, remoteId)
}

/**
 * Placement: room and times onto submissions that already exist.
 *
 * Last, because it can only move a record the previous phase created, and separate from
 * that phase because a create and a schedule are two different writes on the submissions
 * table: rolling them together would make a CPU limit hit between them look like a
 * finished import with an empty agenda.
 *
 * It contributes no counts. `ImportEntityType` has no agenda member, and folding
 * placements into `submission.updated` would double every scheduled session in the one
 * number that is supposed to answer "did this re-run match what it created last time".
 */
export async function runAgendaPhase(ctx: PhaseContext): Promise<PhaseOutcome> {
  for (const submission of ctx.normalized.submissions) {
    // Nothing to place, so nothing is written. Sending an empty schedule would CLEAR the
    // room and times an organizer set by hand, because `scheduleFields` always writes all
    // three columns, and a re-import must never undo local scheduling work.
    if (submission.startsAt === undefined && submission.roomRemoteId === undefined) continue

    const submissionId = ctx.ledger.localIdFor('submission', submission.remoteId)
    if (submissionId === undefined) continue

    await ctx.write.scheduleSubmission({
      submissionId,
      eventId: ctx.eventId,
      roomId: resolve(ctx, 'room', submission.roomRemoteId),
      startsAt: submission.startsAt,
      endsAt: submission.endsAt,
    })
  }
  return { counts: {} }
}
