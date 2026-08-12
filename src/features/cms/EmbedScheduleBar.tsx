'use client'

// The visitor's own schedule, as a control strip above the session views. R9, EMB-10/11.
//
// It owns three things and deliberately no more: whether the list is filtered to the starred
// sessions, turning the current picks into a downloaded .ics, and clearing them. Every rule
// about what a schedule IS lives in `@/features/cms/personal-schedule` and
// `@/features/cms/schedule-store`, both pure and tested; this file is the browser half that a
// test cannot reach.
//
// IT NO LONGER READS STORAGE, and that is a fixed defect rather than tidying. It used to fill
// the parent provider's state from a `useEffect` here, which is a child updating a parent
// during the parent's own mount: React logged `Can't perform a React state update on a
// component that hasn't mounted yet` and dropped the update, so a reload showed `MY SCHEDULE 0`
// with hollow stars over storage that still held the picks. The read is now
// `useSyncExternalStore` in the provider (schedule-store.ts says why), and the WRITE moved with
// it, which fixed a second bug in passing: `Clear` emptied the list in memory only, so the next
// reload brought every cleared session back.
//
// IT WAITS FOR HYDRATION BEFORE IT SAYS ANYTHING, and that is the second half of the same defect.
// This comment used to argue the opposite: that the pre-hydration state and the state of a visitor
// who has starred nothing are the same state, so nothing misleading is on screen. They are the
// same PIXELS and they are not the same claim. `MY SCHEDULE 0` next to a disabled export is the
// widget asserting that the visitor has starred nothing, and for the two to six seconds this tree
// takes to hydrate that assertion is false for every returning visitor. Two eval agents read it
// the same way and filed it as lost data.
//
// So while `hydrated` is false the bar is a skeleton of its own shape: no number, no disabled
// button, no missing Clear. Nothing is claimed, nothing looks pressable, and the strip does not
// change size when the real controls arrive. `EmbedViewState.tsx` says how the flag works.

import { CalendarPlusIcon, StarIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useEmbedViewState } from '@/features/cms/EmbedViewState'
import { buildScheduleIcs, toggleScheduled } from '@/features/cms/personal-schedule'

export function EmbedScheduleBar({ eventName }: { eventName: string }) {
  const schedule = useEmbedViewState()
  // How many sessions the last download carried, or `undefined` for "no download yet".
  // Cleared on a timer below rather than left on screen, so it reads as a receipt for the
  // click and not as a permanent label on the button.
  const [downloaded, setDownloaded] = useState<number | undefined>(undefined)

  // Above the early return with every other hook, because a widget with no sessions returns
  // null and React counts hooks by call order.
  useEffect(() => {
    if (downloaded === undefined) return
    const timer = setTimeout(() => {
      setDownloaded(undefined)
    }, 6000)
    return () => {
      clearTimeout(timer)
    }
  }, [downloaded])

  // No provider means the editor's preview panel, which has no schedule to offer.
  if (schedule === undefined || schedule.sessions.length === 0) return null

  const { scheduled, sessions, onlyMine, hydrated, setOnlyMine, setScheduled } = schedule

  // Nothing here can answer honestly until the store has been read, so nothing here answers.
  if (!hydrated) return <ScheduleBarSkeleton />

  const download = () => {
    const chosen = scheduled.flatMap((id) => {
      const session = sessions.find((candidate) => candidate.id === id)
      return session === undefined ? [] : [session]
    })
    downloadIcs(
      buildScheduleIcs({ eventName, sessions: chosen, dtstamp: new Date().toISOString() }),
      `${slug(eventName)}-schedule.ics`,
    )
    // A download is the one action in this widget with NO on-page consequence: the file
    // lands wherever the browser puts it, the bar looks identical, and the run recorded a
    // visitor clicking with no way to tell whether anything happened. Said inline rather
    // than as a toast because this renders inside an iframe the conference sizes, and a
    // toast pinned to the viewport corner can land outside it entirely.
    setDownloaded(chosen.length)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pb-3">
      {/* `hit-area-y-[36px]` and not `hit-area-y`: this strip wraps on a phone, and the
          wrapped pitch is 28px of button plus the row's `gap-2`, so 36 is the tallest
          band where two rows meet without overlapping. Full width is kept, which the
          square `hit-area-[36px]` would have thrown away. */}
      <Button
        variant={onlyMine ? 'default' : 'outline'}
        size="sm"
        className="hit-area-y-[36px]"
        onClick={() => setOnlyMine(!onlyMine)}
      >
        <StarIcon data-icon="inline-start" />
        My schedule
        <Badge variant="secondary" className="tabular-nums">
          {scheduled.length}
        </Badge>
      </Button>

      {/* Disabled rather than hidden with nothing starred, so a visitor can see that
          exporting is possible before they have picked anything. */}
      <Button
        variant="outline"
        size="sm"
        className="hit-area-y-[36px]"
        disabled={scheduled.length === 0}
        onClick={download}
      >
        <CalendarPlusIcon data-icon="inline-start" />
        Add to calendar
      </Button>

      {scheduled.length === 0 ? null : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setScheduled([])
            setOnlyMine(false)
          }}
        >
          Clear
        </Button>
      )}

      {downloaded === undefined ? null : (
        // `role="status"` so a screen reader is told too. A download is invisible to
        // assistive technology otherwise, exactly as it was invisible on screen.
        <p role="status" className="text-sm tabular-nums text-muted-foreground">
          Downloaded {downloaded} {downloaded === 1 ? 'session' : 'sessions'} as .ics
        </p>
      )}
    </div>
  )
}

/**
 * The bar's own shape, while the schedule is still being read.
 *
 * Sized to the two controls it stands in for (`size="sm"` is `h-7` in this button's variants), so
 * the session list below does not shift down when they arrive. The announcement is here rather
 * than on the list skeleton because this renders on every surface that has a schedule and that
 * one does not.
 */
function ScheduleBarSkeleton() {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 pb-3">
      <span className="sr-only">Restoring your schedule</span>
      <Skeleton className="h-7 w-36" />
      <Skeleton className="h-7 w-32" />
    </div>
  )
}

/**
 * The star on one session card.
 *
 * A client island inside a server-rendered card, which is why it reads the schedule from
 * context rather than taking it as a prop: the card that places it is a server component
 * and has no state to pass down. Renders NOTHING with no provider above it, which is what
 * keeps the editor's preview panel from offering a schedule it cannot store.
 */
export function EmbedScheduleStar({ sessionId }: { sessionId: string }) {
  const schedule = useEmbedViewState()
  if (schedule === undefined) return null

  const { scheduled, hydrated, setScheduled } = schedule

  // A hollow star is a claim too: it says this session is not in the visitor's schedule, and
  // before the store has been read that is exactly the false claim EMB-11 was filed on, repeated
  // once per row. `size-8` is what `size="icon"` measures, so the row does not reflow.
  if (!hydrated) return <Skeleton aria-hidden="true" className="size-8 shrink-0 rounded-md" />

  const on = scheduled.includes(sessionId)
  return (
    <Button
      variant="ghost"
      size="icon"
      className="hit-area"
      aria-pressed={on}
      aria-label={on ? 'Remove from my schedule' : 'Add to my schedule'}
      onClick={(event) => {
        // The card around this star is a dialog trigger, so without stopping the bubble a
        // click here would star the session AND open its detail. Starring is the narrower
        // intent and the one the visitor aimed at.
        event.stopPropagation()
        // Persists as well as re-renders: `setScheduled` is the store's writer.
        setScheduled(toggleScheduled(scheduled, sessionId))
      }}
    >
      <StarIcon className={on ? 'fill-current' : undefined} />
    </Button>
  )
}

/**
 * Hands the file to the browser through a blob URL.
 *
 * `download` on an anchor rather than navigating: this runs inside an iframe, and navigating
 * the frame to the .ics would replace the widget with a download the host page never asked
 * for. The object URL is revoked immediately after the click, since the browser has already
 * taken its copy by then.
 */
function downloadIcs(body: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, '-')
      .replaceAll(/^-|-$/gu, '') || 'event'
  )
}
