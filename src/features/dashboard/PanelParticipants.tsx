// The Participants sub-tab, ref 36: the actionable banners, then Program snapshot's two
// panels, PARTICIPANTS BY ROLE and SUBMISSION STATUS.
//
// Both panels' numbers are computed by `roles.ts` and `status-mix.ts` and both are drilled
// into the same place, which is a choice worth stating once here: bodo has no participants
// list (the parity report waives one) and no per-role or per-segment filtered view, so every
// chevron lands on the surface that actually answers the question the row raises. Roles go to
// the accepted-speaker roster on Tasks, which is the only screen in this build that lists
// PEOPLE, and the donut's segments go to Abstracts filtered to the status they count.

import type { AttentionBanner } from '@/features/dashboard/attention'
import { ProgramSnapshot } from '@/features/dashboard/HomeReview'
import { participantsByRole } from '@/features/dashboard/roles'
import { submissionStatusMix } from '@/features/dashboard/status-mix'
import type { SubmissionWithParticipants } from '@/types/domain'

import { RoleMix } from './RoleMix'
import { StatusMix } from './StatusMix'

export function PanelParticipants({
  submissions,
  banners,
  at,
}: {
  submissions: readonly SubmissionWithParticipants[]
  banners: readonly AttentionBanner[]
  at: (path: string) => string
}) {
  return (
    <ProgramSnapshot banners={banners} participantsHref={at('/tasks')}>
      <div className="grid gap-6 lg:grid-cols-2">
        <RoleMix view={participantsByRole(submissions)} roleHref={() => at('/tasks')} />
        <StatusMix
          view={submissionStatusMix(submissions)}
          // Already filtered to what the row counts, for the reason the "Review submissions"
          // banner gives: a link that lands on everything has made the organizer redo the
          // filtering the legend just did. Abstracts has no abstract-versus-session tab, so
          // both halves of a status share its tab.
          segmentHref={(id) =>
            at(`/abstracts?tab=${id.startsWith('accepted') ? 'accepted' : 'pending'}`)
          }
        />
      </div>
    </ProgramSnapshot>
  )
}
