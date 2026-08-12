// Resolving a submission's cast: the participant rows, and the speakers behind them.
//
// Split out of reads.ts when `listSubmissionsForEvents` was added and that file passed the
// 300 line budget. The seam is a real one rather than an arbitrary cut: everything here is
// about turning two link tables into `SubmissionWithParticipants`, and it is the one piece
// every submission read shares, whether it is scoped to one event, to several, or to a
// single record by id.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { AirtableClient } from '@/services/airtable/client'
import { mapParticipant, mapSpeaker } from '@/services/airtable/mapping'
import type { ReadCache } from '@/services/airtable/read-cache'
import { TABLES } from '@/services/airtable/tables'
import type {
  Speaker,
  Submission,
  SubmissionParticipant,
  SubmissionWithParticipants,
} from '@/types/domain'

type CastMember = SubmissionWithParticipants['participants'][number]

/**
 * Attaches the cast to each submission.
 *
 * A participant whose speaker link resolves to nothing throws rather than being
 * dropped. Dropping it loses a co-presenter from the roster and, worse, from the
 * agenda's speaker-overlap check, which would then report a clean schedule that
 * double-books a human being.
 */
export function attachParticipants(
  submissions: readonly Submission[],
  participants: readonly SubmissionParticipant[],
  speakerById: ReadonlyMap<string, Speaker>,
): readonly SubmissionWithParticipants[] {
  const bySubmission = new Map<string, CastMember[]>()

  for (const participant of participants) {
    const speaker = speakerById.get(participant.speakerId)
    if (speaker === undefined) {
      throw new AppError(ErrorIds.DATA_MISSING_LINK, 'participant points at a missing speaker', {
        participantId: participant.id,
        speakerId: participant.speakerId,
        submissionId: participant.submissionId,
      })
    }
    const cast = bySubmission.get(participant.submissionId) ?? []
    cast.push({ ...participant, speaker })
    bySubmission.set(participant.submissionId, cast)
  }

  return submissions.map((submission) => ({
    ...submission,
    participants: (bySubmission.get(submission.id) ?? []).sort(
      (left, right) => left.sortOrder - right.sortOrder,
    ),
  }))
}

/**
 * The participant rows and the speakers behind them, for whichever submissions `keep` picks.
 *
 * `cache` has to be EVENT scoped, and the same event-scoped set every caller uses. Both reads
 * below are bare `listAll` calls: no filter, no sort, no field list, so `listParams` in
 * client.ts produces one URL regardless of who asked, and Next keys a Data Cache entry on the
 * request rather than on the tags it declares. Every caller of this function is therefore
 * sharing ONE entry per table, and two callers naming different tags over one key is a bug
 * whichever way round it happens: the narrower caller subscribes to writes that do not affect
 * it, the wider one is served an entry that its own write did not expire, and on the
 * file-system cache the mismatch also rewrites the entry's stored tags without refetching it.
 * `getSubmission` passing `submission:{id}` here is exactly that bug, and reads.ts records
 * what it looked like on the session detail page.
 *
 * The `keep` predicate is what narrows the shared answer to one caller's submissions. That is
 * the right place for the narrowing: it happens after the map, so it changes nothing about the
 * request and cannot fragment the entry.
 */
export async function loadCast(
  client: AirtableClient,
  cache: ReadCache,
  keep: (participant: SubmissionParticipant) => boolean,
): Promise<{ participants: readonly SubmissionParticipant[]; speakers: Map<string, Speaker> }> {
  const [participantRecords, speakerRecords] = await Promise.all([
    client.listAll(TABLES.submissionParticipants, cache),
    // Every speaker, not just this event's: a participant row is the authority on
    // who is on a submission, and an unlinked speaker record would otherwise turn
    // into a missing-link error rather than a name on the roster.
    client.listAll(TABLES.speakers, cache),
  ])

  return {
    participants: participantRecords.map(mapParticipant).filter(keep),
    speakers: new Map(speakerRecords.map(mapSpeaker).map((speaker) => [speaker.id, speaker])),
  }
}
