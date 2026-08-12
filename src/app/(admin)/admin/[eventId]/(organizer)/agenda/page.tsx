// /admin/[eventId]/agenda
//
// The page/body split is kept here, unlike the other admin routes, because it earns its
// keep: the header is a fast, data-free strip and `getAgendaData` is six Airtable calls
// behind it, so the title paints while the schedule loads. `params` is awaited here and
// the body takes a plain string.

import { CalendarDaysIcon } from 'lucide-react'
import { Suspense } from 'react'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { requireEventId } from '@/features/events/resolve-ref'

import { AgendaPageBody } from './AgendaPageBody'

export default async function AgendaPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={CalendarDaysIcon}
        title="Agenda"
        description="Manage your event agenda and schedule"
      />

      <Suspense fallback={<AgendaBodySkeleton />}>
        <AgendaPageBody eventId={eventId} />
      </Suspense>
    </div>
  )
}

function AgendaBodySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-96 max-w-full" />
        <Skeleton className="h-8 w-64" />
      </div>
      <Skeleton className="h-[34rem] w-full rounded-xl" />
    </div>
  )
}
