// Which submissions belong to the acting speaker, in the order the portal shows them.
//
// Ownership is deliberately broader than `submitter`. A co-speaker did not file the
// abstract but the session is theirs, they are on the roster, and they get the tasks
// for it, so a portal that keyed on `submitter` alone would show a co-speaker an
// empty Submissions list for a talk they are giving. That same predicate is what the
// mutations authorize against (see `assertOwnsSubmission` in ./authorize.ts), so it
// lives here once rather than being re-expressed per call site.

import type { RecordId, SubmissionWithParticipants } from '@/types/domain'

/** True when this speaker filed the submission or appears on its roster. */
export function speakerOwnsSubmission(
  submission: SubmissionWithParticipants,
  speakerId: RecordId,
): boolean {
  if (submission.submitterId === speakerId) return true
  return submission.participants.some((participant) => participant.speakerId === speakerId)
}

export function ownSubmissions(
  submissions: readonly SubmissionWithParticipants[],
  speakerId: RecordId,
): readonly SubmissionWithParticipants[] {
  return sortNewestFirst(
    submissions.filter((submission) => speakerOwnsSubmission(submission, speakerId)),
  )
}

/**
 * Newest first, per BUILD_SPEC 5.2.
 *
 * `submittedAt` is absent on a draft, and a draft is the newest thing a speaker has
 * touched, so drafts sort to the top rather than to the bottom. The `code` tiebreak
 * is numeric on the `SESS-<n>` suffix: string comparison puts SESS-10 before SESS-9,
 * which is exactly the kind of ordering bug nobody notices until there are ten rows.
 */
export function sortNewestFirst(
  submissions: readonly SubmissionWithParticipants[],
): readonly SubmissionWithParticipants[] {
  return [...submissions].sort((left, right) => {
    const leftAt = submittedAtMs(left.submittedAt)
    const rightAt = submittedAtMs(right.submittedAt)
    if (leftAt !== rightAt) return rightAt - leftAt
    return codeNumber(right.code) - codeNumber(left.code)
  })
}

/** Unsubmitted sorts above everything submitted. */
function submittedAtMs(submittedAt: string | undefined): number {
  if (submittedAt === undefined) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(submittedAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

function codeNumber(code: string): number {
  const digits = /(\d+)\s*$/.exec(code)?.[1]
  return digits === undefined ? 0 : Number.parseInt(digits, 10)
}

/**
 * `SESS-4 - sd`: the code, a hyphen, the title. Transcribed off refs 17-18, where
 * the separator between code and title is a dash (docs/parity/speaker-portal.md).
 */
export function submissionCardTitle(
  submission: Pick<SubmissionWithParticipants, 'code' | 'title'>,
): string {
  return `${submission.code} - ${submission.title}`
}
