// The Today dashboard, refs 34 to 37: shared header and tiles, then one routed sub-tab.
//
// One component behind both routes (`/admin/[eventId]` and `/admin/[eventId]/dashboard/[tab]`)
// so the four sub-tabs cannot drift apart: the kicker, the KPI tiles, the SUBMISSION STATUS
// tiles, the "Also check" strip and the strip's own supersede rule are computed once, here,
// and the tab only decides which panel hangs underneath.
//
// The reads are per tab and that is deliberate; `home-reads.ts` explains which tags each tab
// therefore subscribes to and why the Participants tab must not subscribe to the review graph.
//
// Nothing in this file computes a number. `home-view.ts`, `attention.ts`, `pacing.ts`,
// `roles.ts` and `status-mix.ts` do, and each is unit tested, because every figure on this
// screen is an off-by-one an organizer would act on.

import { adminHref } from '@/components/shell/admin-nav'
import { attentionBanners, stripEntries } from '@/features/dashboard/attention'
import { TODAY_TAB_ID } from '@/features/dashboard/dashboard-tabs'
import { HomeHeader } from '@/features/dashboard/HomeHeader'
import { ReviewProgressCard } from '@/features/dashboard/HomeReview'
import { AdvisoryStrip, KpiTiles, StatusTiles } from '@/features/dashboard/HomeTiles'
import { loadHome } from '@/features/dashboard/home-reads'
import { advisories, statusTiles } from '@/features/dashboard/home-view'
import { acceptedSpeakerCount } from '@/features/dashboard/roles'
import type { HomeTab } from '@/features/dashboard/sub-tabs'

import { DashboardTabs } from './DashboardTabs'
import { PanelAgenda } from './PanelAgenda'
import { PanelForms } from './PanelForms'
import { PanelParticipants } from './PanelParticipants'
import { SubTabs } from './SubTabs'

export async function EventHome({ eventId, tab }: { eventId: string; tab: HomeTab }) {
  const data = await loadHome(eventId, tab)
  const { event, submissions } = data
  const now = new Date()
  const at = (path: string) => adminHref(eventId, path)
  const banners = attentionBanners({ submissions, eventHref: at })
  const checks = advisories({ submissions, eventHref: at })

  return (
    <div className="flex flex-col gap-6">
      <HomeHeader event={event} eventId={eventId} now={now} />

      {/* Ref 34's dashboard tab strip: `Today` plus this event's custom dashboards, each with
          its coloured dot, and `+ Add Dashboard` at the right. `Today` stays selected on all
          four sub-tabs, because the sub-tab strip below is Today's own. */}
      <DashboardTabs eventId={eventId} tabs={data.tabs} active={TODAY_TAB_ID} />

      <KpiTiles
        submissions={submissions.length}
        acceptedSpeakers={acceptedSpeakerCount(submissions)}
      />

      <StatusTiles tiles={statusTiles(submissions)} />

      {/* The banners state the awaiting-decision count on the Participants sub-tab (ref 36),
          and the strip states it everywhere else (ref 34). So the supersede rule only applies
          where the banner is actually on screen: applying it on every tab would drop the item
          from the strip on three tabs that never say it. */}
      <AdvisoryStrip entries={tab === 'participants' ? stripEntries(checks, banners) : checks} />

      <SubTabs eventId={eventId} active={tab} />

      {tab === 'submission-forms' ? (
        <PanelForms
          event={event}
          submissions={submissions}
          forms={data.forms}
          tags={data.tags}
          now={now}
          at={at}
        />
      ) : null}

      {tab === 'participants' ? (
        <PanelParticipants submissions={submissions} banners={banners} at={at} />
      ) : null}

      {tab === 'evaluations' && data.review !== undefined ? (
        <ReviewProgressCard view={data.review} evaluationHref={at('/evaluation')} />
      ) : null}

      {tab === 'agenda' ? (
        <PanelAgenda submissions={submissions} agendaHref={at('/agenda')} />
      ) : null}
    </div>
  )
}
