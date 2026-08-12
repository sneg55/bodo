// One submission card. The same component on the home card and on the list page,
// because refs 17-18 show one card and BUILD_SPEC 5.2 says the list uses "the same
// `SESS-<n> - <title>` card as the home card, the same status badge".
//
// A server component with no state: it appears once per submission and turning it into
// a client component to get a hover style would ship the whole list twice
// (BUILD_SPEC 6.3).

import Link from 'next/link'

import { StatusChip } from '@/components/primitives/StatusChip'
import { submissionCardTitle } from '@/features/portal/own-submissions'
import type { SubmissionWithParticipants } from '@/types/domain'

export type SubmissionCardProps = {
  submission: SubmissionWithParticipants
  /** `Featured Keynote`, `Keynote`. Absent for a submission with no format set. */
  sessionType?: string
  /**
   * Which conference this one is for.
   *
   * Passed only when the speaker has submissions to more than one, which the caller
   * decides (`showsEventNames`). Two rows both reading "Accepted" mean different things at
   * different events, and before the portal spanned events there was nothing to say which.
   */
  eventName?: string
}

export function SubmissionCard({ submission, sessionType, eventName }: SubmissionCardProps) {
  const meta = [eventName, sessionType].filter((part) => part !== undefined).join(' · ')

  return (
    <Link
      href={`/portal/submissions/${encodeURIComponent(submission.code)}`}
      className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-accent"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{submissionCardTitle(submission)}</p>
        {meta === '' ? null : <p className="truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      <StatusChip status={submission.status} withIcon />
    </Link>
  )
}
