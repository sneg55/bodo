// /admin/crm/dashboard
//
// The org-wide view of the speaker database: how many people, how they are distributed across
// the events the viewer belongs to, where they are in the pipeline, what they are tagged with,
// how complete their records are, and how many of them look like duplicates of each other.
// `/admin/[eventId]` cannot answer any of that, because every number on it is scoped to one
// conference and the CRM deliberately is not.
//
// A SIBLING of the `(directory)` route group, not a member of it. The group exists so the
// directory's `loading.tsx` stays off `[speakerId]`, whose `notFound()` would otherwise answer
// HTTP 200 with the 404 body (bodo-conventions.md). Nothing on this route can 404 - there is
// no id in the path to resolve and the layout above has already 404'd a viewer with no
// membership, from the layout BODY, so its status line is sent correctly - which is why it may
// keep the `loading.tsx` beside it. It is a static segment, so that file covers this page and
// nothing else.
//
// The scope is re-derived rather than taken from the layout, for the reason the directory page
// gives: a layout does not revalidate on every navigation and is not a security boundary.

import { UsersIcon } from 'lucide-react'
import Link from 'next/link'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { PageHeader } from '@/components/primitives/PageHeader'
import {
  BarListCard,
  MonthBarsCard,
  StatTile,
  TopSpeakersCard,
} from '@/features/crm/CrmDashboardCards'
import { loadCrmDashboard } from '@/features/crm/dashboard-load'
import { requireCrmScope } from '@/features/crm/scope'

export default async function CrmDashboardPage() {
  const view = await loadCrmDashboard(await requireCrmScope())

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={UsersIcon}
        title="CRM Dashboard"
        description="Your speaker database across every event you belong to."
        actions={
          <ButtonLink href="/admin/crm" variant="outline">
            All speakers
          </ButtonLink>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Speakers" value={view.speakerCount} href="/admin/crm" />
        <StatTile label="Events" value={view.eventCount} />
        <StatTile
          label="Session slots"
          value={view.sessionCount}
          caption={`${view.activeSpeakerCount} people cast`}
        />
        {/* The tile links straight into the directory's duplicates view, so the number is a
            way in rather than a fact to go looking for. */}
        <StatTile
          label="Possible duplicates"
          value={view.duplicateRecords}
          caption={`${view.duplicateClusters} groups`}
          href="/admin/crm?dupes=1"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <BarListCard title="Speakers by event" rows={view.byEvent} />
        <BarListCard title="Speakers by status" rows={view.byStatus} />
        <BarListCard
          title="Top tags"
          rows={view.byTag}
          emptyMessage="No speaker tags have been applied yet."
        />
        <BarListCard title="Profile completeness" rows={view.completeness} />
        <MonthBarsCard title="Portal invitations sent" points={view.invitesByMonth} />
        <TopSpeakersCard speakers={view.topSpeakers} />
      </div>
    </div>
  )
}
