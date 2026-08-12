// The candidate files for a bundle, read event-scoped and reduced to latest versions.
//
// One read composes the whole thing, and both callers use it: the modal (so the organizer
// sees exactly what will be in the archive, and can untick from it) and the download route
// (so the archive is built from a fresh read rather than from anything the URL asserted).
// Sharing it is the point: a modal listing one set and a route streaming another is how a
// bundle silently gains or loses a file.
//
// EVENT SCOPE comes from `listSubmissions(eventId)`, which is the authoritative
// event-scoped read. Everything after it is derived from ids that read produced, so a
// session id the caller invented never reaches the `Files` table. The download route then
// checks each object key's owner against the event's speaker roster as well
// (./object-scope), because the two failures are different: this rules out a foreign
// SESSION, that rules out a foreign OBJECT.
//
// COST, stated rather than discovered later: there is no event-scoped Files read in this
// DAL. `docs/parity/abstracts-review.md` records why ("the `Files` table has no event link
// ... and `createFile` invalidates only `speaker:{id}:files` and `submission:{id}:*`"), and
// adding one means touching reads-portal, queries, tags and the two source files, which
// belong to another surface. So this costs one `Files` listing per selected session, which
// is what MAX_BUNDLE_SESSIONS bounds. Each listing is a tagged, cached fetch, so opening the
// modal warms exactly the entries the download then reads.

import {
  latestVersionsOnly,
  type SessionScope,
  sessionScope,
  withoutDeselected,
} from '@/features/bundle/selection'
import { listFilesForSubmission, listSpeakers, listSubmissions } from '@/services/airtable/queries'
import type { RecordId, Speaker, StoredFile, SubmissionWithParticipants } from '@/types/domain'

/** One file as both the modal and the archive builder need it. */
export type BundleCandidate = {
  readonly id: RecordId
  readonly objectKey: string
  readonly filename: string
  readonly size: number
  readonly kind: StoredFile['kind']
  /**
   * The speaker the row says owns the object, checked AGAINST the key by
   * `assertKeysInEventScope`. Carried for that check and for nothing else: the label the
   * folder grouping uses is `speakerLabel`.
   */
  readonly speakerId: RecordId
  readonly sessionId: RecordId
  /** "SESS-12 Scaling Postgres". The folder name under the default grouping. */
  readonly sessionLabel: string
  readonly speakerLabel: string
}

export type BundleCandidates = {
  readonly scope: SessionScope
  readonly files: readonly BundleCandidate[]
  /** The event's own speaker ids, so the caller can scope object keys without re-reading. */
  readonly speakerIds: readonly string[]
  readonly sessionCount: number
}

export function speakerName(speaker: Speaker | undefined): string {
  if (speaker === undefined) return ''
  const name = `${speaker.firstName} ${speaker.lastName}`.trim()
  return name === '' ? speaker.email : name
}

/** `SESS-12 Scaling Postgres`, which is how the organizer refers to the session anyway. */
export function sessionLabel(submission: SubmissionWithParticipants): string {
  return `${submission.code} ${submission.title}`.trim()
}

/**
 * The speaker ids this event vouches for, which is what `assertKeysInEventScope` checks an
 * object key's owner against.
 *
 * Two event-scoped sources unioned, not one, and the second is not belt and braces. The roster
 * comes from `listSpeakers`, which filters the `Speakers` table on the record's own event
 * links; the participants come from `listSubmissions`, which is scoped by the submission's.
 * Those can disagree: a `Speakers` row whose event link was cleared while it is still cast on
 * a session of this event would drop off the roster, and with the roster alone the whole
 * download would then be refused for a file the event plainly owns. Both sources are derived
 * from the event, so the union widens nothing an attacker controls.
 */
export function eventSpeakerIds(
  submissions: readonly SubmissionWithParticipants[],
  speakers: readonly Speaker[],
): readonly string[] {
  const ids = new Set(speakers.map((speaker) => speaker.id))
  for (const submission of submissions) {
    for (const participant of submission.participants) {
      ids.add(participant.speakerId)
    }
  }
  return [...ids]
}

/**
 * Candidate files for a checked selection of sessions.
 *
 * `deselectedFileIds` is applied last, after the latest-version rule, because the modal
 * lists survivors: unticking is a statement about what it showed. Doing it the other way
 * round would let an unticked old version promote its own predecessor into the archive.
 */
export async function loadBundleCandidates(input: {
  eventId: RecordId
  checkedSessionIds: readonly string[]
  deselectedFileIds?: readonly string[]
}): Promise<BundleCandidates> {
  const [submissions, speakers] = await Promise.all([
    listSubmissions(input.eventId),
    listSpeakers(input.eventId),
  ])

  const scope = sessionScope({
    eventSessionIds: submissions.map((submission) => submission.id),
    checkedIds: input.checkedSessionIds,
  })
  const speakerIds = eventSpeakerIds(submissions, speakers)

  if (scope.problem !== undefined) {
    return { scope, files: [], speakerIds, sessionCount: scope.sessionIds.length }
  }

  const byId = new Map(submissions.map((submission) => [submission.id, submission]))
  const namesById = new Map(speakers.map((speaker) => [speaker.id, speakerName(speaker)]))

  const perSession = await Promise.all(
    scope.sessionIds.map(async (sessionId) => ({
      sessionId,
      files: await listFilesForSubmission(sessionId),
    })),
  )

  const candidates = perSession.flatMap(({ sessionId, files }) => {
    const submission = byId.get(sessionId)
    // Unreachable: `sessionId` came out of `submissions` above. Guarded rather than asserted
    // because an empty label would silently fold a session's files into "Unassigned".
    if (submission === undefined) return []

    return latestVersionsOnly(files).map((file) => ({
      id: file.id,
      objectKey: file.objectKey,
      filename: file.filename,
      size: file.size,
      kind: file.kind,
      speakerId: file.speakerId,
      sessionId,
      sessionLabel: sessionLabel(submission),
      speakerLabel: namesById.get(file.speakerId) ?? '',
    }))
  })

  return {
    scope,
    files: withoutDeselected(candidates, input.deselectedFileIds ?? []),
    speakerIds,
    sessionCount: scope.sessionIds.length,
  }
}
