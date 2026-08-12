// Home: the My Submissions card (ref 17).
//
// Header `My Submissions (<count>)` with a right-aligned `View All` link, then one card
// per submission reading `SESS-<n> - <title>` over a session-type subtitle with a
// status badge. Copy is verbatim from docs/parity/speaker-portal.md.
//
// The count is in the header, so the header cannot be drawn before the read finishes: it
// depends on who is asking. `Fallback` therefore renders the same card frame with the
// title alone, and the count arrives with the rows.

import { CalendarIcon } from 'lucide-react'
import Link from 'next/link'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Skeleton } from '@/components/ui/skeleton'
import { PortalCard } from '@/features/portal/PortalCard'
import { readOwnSubmissions, showsEventNames } from '@/features/portal/reads'
import { SubmissionCard } from '@/features/portal/SubmissionCard'
import { formatOptions, sessionTypeLabel } from '@/features/portal/session-type'

function ViewAll() {
  return (
    <ButtonLink
      href="/portal/submissions"
      variant="ghost"
      // 28px in a header bar whose `py-2.5` leaves 10px above and below it, and nothing
      // else in that bar is pressable, so the band's 6px each way stays inside it.
      className="hit-area-y h-7 px-2 text-xs font-normal text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
    >
      View All
    </ButtonLink>
  )
}

export function MySubmissionsCardFallback() {
  return (
    <PortalCard icon={CalendarIcon} title="My Submissions" action={<ViewAll />}>
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </PortalCard>
  )
}

export async function MySubmissionsCard() {
  const own = await readOwnSubmissions()
  const { submissions, forms } = own
  const named = showsEventNames(own)

  return (
    <PortalCard
      icon={CalendarIcon}
      title={`My Submissions (${String(submissions.length)})`}
      action={<ViewAll />}
    >
      {submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have no submissions yet.</p>
      ) : (
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
      )}
    </PortalCard>
  )
}
