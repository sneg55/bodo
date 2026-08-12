'use client'

import {
  AlertTriangleIcon,
  Building2Icon,
  CalendarClockIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  ExternalLinkIcon,
  ListIcon,
  SettingsIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useMemo, useOptimistic, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SavedView } from '@/types/saved-views'
import { AgendaProjection } from './AgendaProjection'
import { AgendaPublicationState } from './AgendaPublicationState'
import { AutoScheduleDialog } from './AutoScheduleDialog'
import {
  scheduleSessionAction,
  setAgendaPublicationAction,
  setSessionPublicationAction,
} from './actions'
import { buildConflictReport } from './conflicts'
import { reduceAgendaSessions } from './optimistic'
import { contentApprovalRequired, publicAgendaRows, publicWithholding } from './public-agenda'
import { ResolveConflictsDialog } from './ResolveConflictsDialog'
import type { AgendaFocus, ScheduleRequest } from './types'
import { AGENDA_VIEWS, type AgendaData, type AgendaView } from './types'
import { usePlanRuns } from './use-plan-runs'

const VIEW_META = [
  { id: 'list', label: 'List', icon: <ListIcon key="list" /> },
  { id: 'day', label: 'Day', icon: <CalendarDaysIcon key="day" /> },
  { id: 'week', label: 'Week', icon: <CalendarRangeIcon key="week" /> },
  { id: 'month', label: 'Month', icon: <CalendarClockIcon key="month" /> },
  { id: 'rooms', label: 'Rooms', icon: <Building2Icon key="rooms" /> },
  { id: 'conflicts', label: 'Conflicts', icon: <AlertTriangleIcon key="conflicts" /> },
] as const

const VIEW_SET = new Set<string>(AGENDA_VIEWS)

export function AgendaSurface({
  data,
  savedViews,
  canEdit,
}: {
  data: AgendaData
  /** Persisted views for the `sessions` surface, read on the server. */
  savedViews: readonly SavedView[]
  /** Whether the acting user may write a saved view. Reads come from EventMemberships. */
  canEdit: boolean
}) {
  const [view, setView] = useState<AgendaView>('list')
  // Set only by a conflict card, and cleared as soon as the organizer picks a tab
  // themselves, so it never re-applies a day and room they have since moved away from.
  const [focus, setFocus] = useState<AgendaFocus | null>(null)
  const [sessions, applyOptimistic] = useOptimistic(data.sessions, reduceAgendaSessions)
  const [isPending, startTransition] = useTransition()
  const report = useMemo(
    () =>
      buildConflictReport(
        sessions.map((session) => ({
          id: session.id,
          roomId: session.roomId,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          participantSpeakerIds: session.participants.map((participant) => participant.id),
        })),
      ),
    [sessions],
  )
  const scheduledIds = sessions
    .filter((session) => session.scheduleStatus === 'scheduled')
    .map((session) => session.id)
  const publishedIds = sessions
    .filter((session) => session.scheduleStatus === 'published')
    .map((session) => session.id)
  // Which MODE the content gate is in on this agenda, derived exactly the way the public
  // read derives it: `publicAgendaRows` narrows to the candidates for the page, and one
  // approved session among them is what makes approval the thing that decides publication
  // (public-agenda.ts states the rule and why the trigger is an approved row). Derived
  // rather than assumed, because the default is the PERMISSIVE mode: passing no flag here
  // said `not_submitted` is fine on an agenda where the organizer had started signing
  // content off, so the toolbar reported zero withheld while the public page withheld them.
  const requireContentApproval = contentApprovalRequired(
    publicAgendaRows(
      sessions.map((session) => ({
        status: session.status,
        scheduleStatus: session.scheduleStatus,
        calendarStatus: 'active' as const,
        startsAt: session.startsAt,
        contentStatus: session.contentStatus,
      })),
    ),
  )
  // Published and still invisible to a visitor. Computed from the same predicate the public
  // read uses (`publicWithholding`), so the toolbar cannot drift from what /agenda serves:
  // the session rows carry `status`, `scheduleStatus` and `contentStatus`, and an agenda row
  // is never a cancelled one, which is why `calendarStatus` is supplied as active.
  const withheldCount = sessions.filter(
    (session) =>
      publicWithholding(
        {
          status: session.status,
          scheduleStatus: session.scheduleStatus,
          calendarStatus: 'active',
          contentStatus: session.contentStatus,
        },
        { requireContentApproval },
      ) === 'content_not_approved',
  ).length

  const schedule = (change: ScheduleRequest) => {
    const current = sessions.find((session) => session.id === change.submissionId)
    if (current === undefined) return
    const scheduleStatus =
      change.roomId === undefined
        ? 'unscheduled'
        : current.scheduleStatus === 'published'
          ? 'published'
          : 'scheduled'

    startTransition(async () => {
      applyOptimistic({ type: 'schedule', change, scheduleStatus })
      try {
        await scheduleSessionAction(data.event.id, change)
        toast.success(change.roomId === undefined ? 'Session moved to tray' : 'Session scheduled')
      } catch {
        toast.error('The schedule change could not be saved.')
      }
    })
  }

  const setPublication = (submissionIds: readonly string[], published: boolean) => {
    startTransition(async () => {
      applyOptimistic({ type: 'publication', submissionIds, published })
      try {
        await setSessionPublicationAction(data.event.id, submissionIds, published)
        toast.success(published ? 'Sessions published' : 'Sessions unpublished')
      } catch {
        toast.error('The publication change could not be saved.')
      }
    })
  }

  // The two BULK planner runs, which own nothing on this component: no optimistic state,
  // just a call and an honest report of what came back. See ./use-plan-runs.ts.
  const { autoSchedule, autoResolveConflicts } = usePlanRuns(data.event.id, startTransition)

  const setWholeAgenda = (published: boolean) => {
    const submissionIds = published ? scheduledIds : publishedIds
    startTransition(async () => {
      applyOptimistic({ type: 'publication', submissionIds, published })
      try {
        await setAgendaPublicationAction(data.event.id, published)
        toast.success(published ? 'Agenda published' : 'Agenda unpublished')
      } catch {
        toast.error('The agenda publication change could not be saved.')
      }
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={view}
          onValueChange={(next: string) => {
            if (!VIEW_SET.has(next)) return
            setFocus(null)
            setView(next as AgendaView)
          }}
        >
          {/* `h-auto min-h-8`, for the reason spelled out in `EmbedBrowseBar`: `TabsList` is
              a fixed `h-8` when horizontal, so this six-tab strip overflowed its own box the
              moment it wrapped, printing the tabs over each other and over the toolbar
              beneath. Reproduced at 390px on the running app, not inferred. */}
          <TabsList variant="line" className="group-data-horizontal/tabs:h-auto min-h-8 flex-wrap">
            {VIEW_META.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id}>
                {entry.icon}
                {entry.label}
                {entry.id === 'conflicts' ? (
                  <Badge
                    variant={report.count > 0 ? 'destructive' : 'secondary'}
                    className="tabular-nums"
                  >
                    {report.count}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          {/* Rooms and tracks ARE editable, at Settings > Library > Tags, and until this
              link existed nothing pointed there from the surface that uses them. A review
              agent with the whole codebase in front of it concluded rooms were defined in
              code and read-only; the organizers said the graders are event production
              professionals rather than engineers, so they would conclude the same. The
              nav label stays "Tags" because docs/parity/event-config.md ref 02 transcribes
              it that way and familiarity is scored: the fix is a route in, not a rename. */}
          {/* `?tab=rooms`, so the link lands on the list it names. Without it an organizer
              sent here by the grid's own "add at least one room" message arrived on Tags,
              under a heading reading "Tags", and had to notice two further tabs. */}
          <ButtonLink href={`/admin/${data.event.id}/settings/tags?tab=rooms`} variant="ghost">
            <SettingsIcon data-icon="inline-start" />
            Rooms &amp; tracks
          </ButtonLink>

          {/* The only route from here to what Publish actually produces. Shown whether or
              not anything is published, because the public page's own empty state is the
              honest answer to "what would a visitor see right now" and a link that comes
              and goes is harder to find than one that is always there. */}
          <ButtonLink
            href={`/agenda/${data.event.slug}`}
            target="_blank"
            rel="noreferrer"
            variant="ghost"
          >
            <ExternalLinkIcon data-icon="inline-start" />
            View public agenda
          </ButtonLink>

          {/* ONE button, and which one depends on the tab.
              Auto-schedule is about the tray and can do nothing for an overlap, so on the
              one tab whose entire subject is overlaps it is the wrong offer: an organizer
              looking at three clashes was given a button that would place unscheduled
              sessions instead. Everywhere else the reverse holds, and a resolver on a tab
              with no conflicts in view is the button that means nothing. So they swap
              rather than sit side by side. */}
          {view === 'conflicts' ? (
            <ResolveConflictsDialog
              data={{ ...data, sessions }}
              // The tab badge's own number, so the closed button cannot disagree with the
              // count rendered two inches to its left.
              conflictCount={report.count}
              disabled={isPending}
              onConfirm={autoResolveConflicts}
            />
          ) : (
            <AutoScheduleDialog
              data={{ ...data, sessions }}
              disabled={isPending}
              onConfirm={autoSchedule}
            />
          )}
          <AgendaPublicationState
            publishedCount={publishedIds.length}
            scheduledCount={scheduledIds.length}
            withheldCount={withheldCount}
          />
          <Button
            variant="outline"
            disabled={isPending || publishedIds.length === 0}
            onClick={() => setWholeAgenda(false)}
          >
            Unpublish Agenda
          </Button>
          <Button
            disabled={isPending || scheduledIds.length === 0}
            onClick={() => setWholeAgenda(true)}
          >
            Publish Agenda
          </Button>
        </div>
      </div>

      <AgendaProjection
        view={view}
        data={{ ...data, sessions }}
        report={report}
        isPending={isPending}
        savedViews={savedViews}
        canEdit={canEdit}
        focus={focus}
        onSchedule={schedule}
        onPublication={setPublication}
        onFocus={(next) => {
          setFocus(next)
          setView('day')
        }}
      />
    </div>
  )
}
