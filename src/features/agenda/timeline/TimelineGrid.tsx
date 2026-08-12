'use client'

import { useDroppable } from '@dnd-kit/core'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Fragment, type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/utils/cn'

import type { ConflictReport } from '../conflicts'
import { formatMinutes } from '../time'
import type { AgendaSession } from '../types'
import { AgendaDndCard } from './AgendaDndCard'
import { scrollReach, scrollStep, timelineColumns, timelineMinWidthRem } from './timeline-geometry'
import {
  cellId,
  SLOT_HEIGHT,
  type TimelineLane,
  timelineLayout,
  timelineSlots,
} from './timeline-model'

/** The viewport `ScrollArea` scrolls, found from the content rather than from a ref it does not expose. */
const VIEWPORT = '[data-slot="scroll-area-viewport"]'

export function TimelineGrid({
  sessions,
  lanes,
  timeZone,
  report,
  disabled,
  focusedSessionId,
}: {
  sessions: readonly AgendaSession[]
  lanes: readonly TimelineLane[]
  timeZone: string
  report: ConflictReport
  disabled: boolean
  /** Ringed on arrival, so a session opened from the Conflicts tab is findable. */
  focusedSessionId?: string
}) {
  const slots = timelineSlots()
  const placements = timelineLayout(sessions, lanes, timeZone)
  const columns = timelineColumns(lanes.length)
  const { contentRef, reach, page } = useLaneScroller(lanes.length)

  return (
    <Card className="min-w-0 gap-0 py-0">
      {reach.start || reach.end ? (
        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
          {/* `tabular-nums`: the lane count changes as the day or the room set changes,
              and the sentence after it shifts sideways when the digit width does. */}
          <p className="mr-auto text-xs text-muted-foreground tabular-nums">
            {lanes.length} columns. Scroll sideways to reach them all.
          </p>
          {/* `hit-area-[36px]` on both, not `hit-area`: they are 28x28 sitting in a `gap-2`
              row, so their centres are 28 + 8 = 36px apart. At 40 the two areas would
              overlap by 4px and the press would land on whichever won the stacking order.
              36 is the pitch, so they meet and never cross. Vertically the row's `py-1.5`
              leaves 6px on each side and nothing interactive above or below. */}
          <Button
            variant="outline"
            size="icon-sm"
            className="hit-area-[36px]"
            aria-label="Show earlier columns"
            disabled={!reach.start}
            onClick={() => page(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="hit-area-[36px]"
            aria-label="Show later columns"
            disabled={!reach.end}
            onClick={() => page(1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      ) : null}
      <ScrollArea className="h-[38rem] w-full">
        {/* A DEFINITE minimum width, not `min-w-max`. See timeline-geometry.ts: with
            `min-w-max` the widest session title on the day sized the columns, which is how
            seven rooms came to need a 3400px browser. */}
        <div
          ref={contentRef}
          style={{ minWidth: `${String(timelineMinWidthRem(lanes.length))}rem` }}
        >
          <div
            className="sticky top-0 z-20 grid border-b border-border bg-card"
            style={{ gridTemplateColumns: columns }}
          >
            <div className="border-r border-border p-2 text-xs text-muted-foreground">Time</div>
            {lanes.map((lane) => (
              <div
                key={lane.id}
                className="min-w-0 border-r border-border px-3 py-2 last:border-r-0"
              >
                {/* `truncate` on both, because the column no longer grows to fit them. */}
                <p className="truncate font-medium">{lane.label}</p>
                {lane.detail === undefined ? null : (
                  <p className="truncate text-xs text-muted-foreground">{lane.detail}</p>
                )}
              </div>
            ))}
          </div>

          <div
            className="relative grid bg-card"
            style={{
              gridTemplateColumns: columns,
              gridTemplateRows: `repeat(${slots.length}, ${SLOT_HEIGHT}px)`,
            }}
          >
            {slots.map((minute, rowIndex) => (
              <Fragment key={minute}>
                <div
                  className={cn(
                    'border-r border-b border-border px-2 pt-1 text-right text-[0.6875rem] text-muted-foreground tabular-nums',
                    minute % 60 === 0 ? 'border-b-border' : 'border-b-border/50',
                  )}
                  style={{ gridColumn: 1, gridRow: rowIndex + 1 }}
                >
                  {minute % 60 === 0 ? formatMinutes(minute) : null}
                </div>
                {lanes.map((lane, laneIndex) => (
                  <TimelineCell
                    key={cellId(lane, minute)}
                    id={cellId(lane, minute)}
                    column={laneIndex + 2}
                    row={rowIndex + 1}
                    strong={minute % 60 === 0}
                  />
                ))}
              </Fragment>
            ))}

            {sessions.map((session) => {
              const placement = placements.get(session.id)
              if (placement === undefined) return null
              return (
                <AgendaDndCard
                  key={session.id}
                  session={session}
                  report={report}
                  disabled={disabled}
                  resize
                  focused={session.id === focusedSessionId}
                  className="relative z-10 p-0.5"
                  gridStyle={{
                    gridColumn: placement.laneIndex + 2,
                    gridRow: `${placement.rowStart} / span ${placement.rowSpan}`,
                    // Percentages resolve against the grid area, so a session that shares
                    // its slot with another takes a column of the lane instead of covering
                    // it. One column wide is the whole lane, which is the common case.
                    width: `${String(100 / placement.columns)}%`,
                    marginInlineStart: `${String((100 * placement.column) / placement.columns)}%`,
                  }}
                />
              )
            })}
          </div>
        </div>
      </ScrollArea>
    </Card>
  )
}

/**
 * Paging the grid sideways, and knowing whether it can be paged at all.
 *
 * A HORIZONTAL affordance is the whole point. `ScrollArea` renders a vertical scrollbar
 * only (src/components/ui/scroll-area.tsx, which is generated and must not be edited), and
 * its Base UI viewport hides the native ones, so a grid wider than its viewport had no
 * scrollbar to grab, ignored a plain wheel (which scrolls the vertical axis, correctly),
 * and needed a horizontal trackpad gesture nobody discovers. Two buttons that call
 * `scrollBy` on the same viewport are reachable by mouse and by keyboard, and they are
 * rendered ONLY when there is something off screen, so neither is ever a dead control.
 *
 * The viewport is found with `closest()` rather than a ref because the wrapper does not
 * expose one; `data-slot="scroll-area-viewport"` is the wrapper's own stable attribute.
 */
function useLaneScroller(laneCount: number): {
  contentRef: RefObject<HTMLDivElement | null>
  reach: { start: boolean; end: boolean }
  page: (direction: -1 | 1) => void
} {
  const contentRef = useRef<HTMLDivElement>(null)
  const [reach, setReach] = useState({ start: false, end: false })

  const viewport = useCallback((): HTMLElement | undefined => {
    const found = contentRef.current?.closest(VIEWPORT)
    return found instanceof HTMLElement ? found : undefined
  }, [])

  useEffect(() => {
    const content = contentRef.current
    const element = viewport()
    if (content === null || element === undefined) return

    const update = () => {
      const next = scrollReach(element.scrollLeft, element.scrollWidth, element.clientWidth)
      // Only when the ANSWER changes, not on every scroll frame: this grid is 40 rows of
      // droppable cells per lane, and re-rendering it through a smooth scroll would make
      // the paging buttons the slowest control on the page.
      setReach((current) =>
        current.start === next.start && current.end === next.end ? current : next,
      )
    }
    update()
    element.addEventListener('scroll', update, { passive: true })
    // Both, because either changes the answer: the viewport when the window or the tray
    // beside it resizes, the content when the lane count or a room name does.
    const observer = new ResizeObserver(update)
    observer.observe(element)
    observer.observe(content)
    return () => {
      element.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [viewport, laneCount])

  const page = useCallback(
    (direction: -1 | 1) => {
      const element = viewport()
      if (element === undefined) return
      element.scrollBy({
        left: direction * scrollStep(element.clientWidth, laneCount),
        behavior: 'smooth',
      })
    },
    [viewport, laneCount],
  )

  return { contentRef, reach, page }
}

function TimelineCell({
  id,
  column,
  row,
  strong,
}: {
  id: string
  column: number
  row: number
  strong: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'border-r border-b border-border/50 transition-colors last:border-r-0',
        strong && 'border-b-border',
        isOver && 'bg-accent',
      )}
      style={{ gridColumn: column, gridRow: row }}
    />
  )
}
