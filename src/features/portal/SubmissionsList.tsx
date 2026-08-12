// /portal/submissions: the same card as the home card, newest first.
//
// BUILD_SPEC 5.2 specifies this page rather than a screenshot doing it, and it is
// specific: "the same `SESS-<n> - <title>` card as the home card, the same status badge,
// sorted newest first, with the pill nav's `Submissions` tab active". So there is no new
// row component here, only the list.

import { Skeleton } from '@/components/ui/skeleton'
import { readOwnSubmissions, showsEventNames } from '@/features/portal/reads'
import { SubmissionCard } from '@/features/portal/SubmissionCard'
import { formatOptions, sessionTypeLabel } from '@/features/portal/session-type'

export function SubmissionsListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  )
}

export async function SubmissionsList() {
  const own = await readOwnSubmissions()
  const { submissions, forms } = own

  if (submissions.length === 0) {
    return <p className="text-sm text-muted-foreground">You have no submissions yet.</p>
  }

  // Only when the speaker is in more than one conference. See `showsEventNames`.
  const named = showsEventNames(own)

  return (
    <div className="space-y-2">
      {submissions.map((submission) => (
        <SubmissionCard
          key={submission.id}
          submission={submission}
          eventName={named ? own.eventNames.get(submission.eventId) : undefined}
          sessionType={sessionTypeLabel(
            submission,
            formatOptions(forms.find((form) => form.id === submission.formId)),
          )}
        />
      ))}
    </div>
  )
}
