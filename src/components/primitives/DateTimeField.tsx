'use client'

// Starts At / Ends At: one combined date-time control (docs/parity/event-config.md ref 03).
//
// Ref 03 shows a single field reading "October 12th, 2026 at 9:00 AM" with a calendar
// icon, the zone abbreviation ("PDT") as a suffix, and a clear X. So this is a `Popover`
// holding a `Calendar` and a time `Input`, not the `Input type="datetime-local"` that
// `AddAbstractSheet` and `AddTaskSheet` use: those two are drawers where a date is
// incidental, and their own comments say the shared date-time control belongs somewhere
// reusable. This is the screen the parity doc actually transcribes a picker on.
//
// The value is an ISO INSTANT and the display is in the event timezone, which is the part
// worth being careful about. A naive `new Date(local)` would interpret the typed wall clock
// in the BROWSER's zone, so an organizer in London scheduling a 9:00 AM New York keynote
// would store 09:00 UTC. `zonedDateTimeToIso` in src/features/agenda/time.ts already solves
// that, and it is reused here rather than reimplemented.
//
// It lived in features/settings while it had one caller, because a primitive with one
// caller is speculative (BUILD_SPEC 10 step 5), and its own note said to move it when a
// second surface needed it. The evaluation plan editor is that second surface: a round's
// open and close dates belong to the conference's calendar in exactly the way the event's
// own dates do, so the zone handling above is the reason to share this rather than reach
// for another `datetime-local`.

import { CalendarIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import {
  calendarDate,
  calendarDateKey,
  formatLongDate,
  parseTimeValue,
  timeValue,
  todayKeyIn,
} from '@/components/primitives/date-time-field-format'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  dateKeyAt,
  formatMinutes,
  minutesAt,
  zoneAbbrevAt,
  zonedDateTimeToIso,
} from '@/features/agenda/time'

export type DateTimeFieldProps = {
  id: string
  /** ISO instant, or undefined when cleared. */
  value: string | undefined
  timeZone: string
  onChange: (value: string | undefined) => void
}

const DEFAULT_MINUTE_OF_DAY = 9 * 60

/**
 * What the year dropdown offers: five years back, five forward.
 *
 * Computed at module scope, which is a constant per isolate rather than mutable state used
 * as a cache. It is a picker range and nothing is stored from it, so an isolate that lives
 * across a new year offering 2031 in a 2032 list is not a defect worth a render-time clock
 * read; anything outside the range is typed into the Date box next to it.
 */
const YEAR_RANGE = {
  start: new Date(new Date().getFullYear() - 5, 0, 1),
  end: new Date(new Date().getFullYear() + 5, 11, 31),
}

export function DateTimeField({ id, value, timeZone, onChange }: DateTimeFieldProps) {
  const [open, setOpen] = useState(false)

  const dateKey = value === undefined ? undefined : dateKeyAt(value, timeZone)
  const minuteOfDay = value === undefined ? undefined : minutesAt(value, timeZone)
  const abbrev = value === undefined ? undefined : zoneAbbrevAt(value, timeZone)

  // The DISPLAYED month, owned here rather than inside react-day-picker. Two defects, one
  // cause. The calendar picks its opening month as `month || defaultMonth || today` and
  // never consults `selected` (react-day-picker helpers/getInitialMonth.js), so a session
  // dated October opened on the current month and scheduling it took two next-month
  // presses. And left uncontrolled, the month and year dropdowns write to state inside the
  // calendar that a remount of this popover resets, which is the report of the selects
  // reading a new year while the grid stayed where it was. Controlling it means the grid
  // and both dropdowns render from ONE value: `goToMonth` calls `onMonthChange`, which
  // sets this, which the calendar renders.
  const [month, setMonth] = useState<Date>(() => calendarDate(dateKey ?? todayKeyIn(timeZone)))

  function commit(nextDateKey: string, nextMinuteOfDay: number): void {
    const iso = zonedDateTimeToIso(nextDateKey, nextMinuteOfDay, timeZone)
    if (iso !== undefined) onChange(iso)
    // The typed Date box below commits too, and the grid follows it: typing 2027-05 and
    // then reaching for the picker to choose the day should not land back on today.
    setMonth(calendarDate(nextDateKey))
  }

  return (
    // `min-w-0` on BOTH this row and the trigger, and neither is decoration.
    //
    // The trigger already carried `flex-1` and a `truncate` span, and neither could do
    // anything: a flex item's `min-width` defaults to `auto`, which floors it at its own
    // min-content width, and `truncate` sets `white-space: nowrap`, so that floor was the
    // full width of the label. `flex-1` cannot shrink past a floor, so the field sized
    // itself to its text and overflowed whatever held it. In the two-column grid of the Add
    // Abstract sheet that meant Starts At running under the Ends At icon, Ends At clipped by
    // the sheet edge, and BOTH clear buttons pushed out of the drawer entirely.
    //
    // The same floor propagates upwards, which is why the row needs it too: without it this
    // div reports the un-shrinkable trigger as its own min-content and the grid item above
    // overflows its track instead of the field shrinking inside it. Fixed in the primitive
    // rather than at the four call sites, because the primitive is what could not shrink.
    <div className="flex min-w-0 items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Re-seeded on every open rather than only at mount: the value changes under this
          // component, and a month left over from the last time it was open is how a picker
          // comes back on a year nobody asked for.
          if (next) setMonth(calendarDate(dateKey ?? todayKeyIn(timeZone)))
          setOpen(next)
        }}
      >
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              className="min-w-0 flex-1 justify-start font-normal"
            />
          }
        >
          <CalendarIcon className="shrink-0 text-muted-foreground" />
          {/* `tabular-nums`, and in a field that truncates it is load-bearing rather than
              cosmetic. The day, the year and the hour all change under this label, and with
              proportional figures "1" is narrow, so stepping 11 -> 12 or 9:00 -> 11:00 moves
              the whole string's width. The comment on the clear button below is about the
              ~14px that decides whether the last character survives the ellipsis; equal-width
              digits are what stops that margin moving every time the value does. */}
          <span className="truncate tabular-nums">
            {dateKey === undefined || minuteOfDay === undefined
              ? 'Select a date and time'
              : `${formatLongDate(dateKey)} at ${formatMinutes(minuteOfDay)}`}
          </span>
        </PopoverTrigger>
        {/* Capped to the space the positioner reports, and scrolled past that.
            Without it the popup keeps its natural ~315px and, on a laptop viewport with the
            field low on the page, Base UI flips it above the trigger, where it lands squarely
            on top of the form editor's own header. The 2026-08-12 eval run filed that as a
            major defect from the organizer's side of it: pick a close date, press SAVE, and
            nothing happens, because SAVE is underneath the calendar. Reproduced here, and the
            browser refused the click with "covered by <div#_r_0_> at its click point".
            `--available-height` is the positioner's own measurement, so this fits whichever
            side it ends up on rather than guessing a number. */}
        <PopoverContent
          className="max-h-[var(--available-height)] w-auto gap-2 overflow-y-auto p-2"
          align="start"
          // Never flip above the trigger, and scroll inside the cap instead. Capping the
          // height alone did NOT fix this: `--available-height` is measured after the side is
          // chosen, so a popup that had already flipped just fitted itself into the space it
          // had claimed over the header. Pinning the side is what keeps SAVE clickable.
          collisionAvoidance={{ side: 'none' }}
        >
          <Calendar
            // Cascades to the day grid and the year dropdown: a month grid is a table of
            // numbers, and proportional figures leave the 1s narrow so the columns bow.
            className="tabular-nums"
            mode="single"
            autoFocus
            // Month and year as DROPDOWNS rather than a caption you can only page past.
            // Conference dates are set months or years out, and with the arrows alone,
            // reaching next October from August is nine presses of the same button.
            // `startMonth`/`endMonth` are what the year dropdown enumerates; without them
            // react-day-picker offers a narrow window around today, which is the wrong
            // window for an event calendar.
            captionLayout="dropdown"
            startMonth={YEAR_RANGE.start}
            endMonth={YEAR_RANGE.end}
            month={month}
            onMonthChange={setMonth}
            selected={dateKey === undefined ? undefined : calendarDate(dateKey)}
            onSelect={(next) => {
              if (next === undefined) return
              commit(calendarDateKey(next), minuteOfDay ?? DEFAULT_MINUTE_OF_DAY)
            }}
          />
          {/* The date is TYPEABLE as well as clickable, and the calendar is the second way
              in rather than the only one.

              Paging a calendar to a date fourteen months out is four or five interactions
              for a value somebody can say in eight characters, and it is worse than that
              for anyone driving this from the keyboard: a grid of 30 buttons has no way to
              jump. The conference dates being set here are usually already known and
              already written down somewhere, so typing them is the common case and the
              picker is for choosing.

              Both write through `commit`, so there is one place that decides what a wall
              clock in the event's zone means as an instant. */}
          <div className="flex items-center gap-2 border-t border-border px-1 pt-2">
            <Label htmlFor={`${id}-date`} className="text-xs text-muted-foreground">
              Date
            </Label>
            <Input
              id={`${id}-date`}
              type="date"
              className="w-36 tabular-nums"
              value={dateKey ?? ''}
              onChange={(event) => {
                const next = event.target.value
                // An empty box is somebody mid-edit, not a request to clear: the X button is
                // what clears, and committing on empty would blank the time as well.
                if (!/^\d{4}-\d{2}-\d{2}$/u.test(next)) return
                commit(next, minuteOfDay ?? DEFAULT_MINUTE_OF_DAY)
              }}
            />
            <Label htmlFor={`${id}-time`} className="text-xs text-muted-foreground">
              Time
            </Label>
            <Input
              id={`${id}-time`}
              type="time"
              className="w-32 tabular-nums"
              value={minuteOfDay === undefined ? '' : timeValue(minuteOfDay)}
              onChange={(event) => {
                const parsed = parseTimeValue(event.target.value)
                if (parsed === undefined) return
                commit(dateKey ?? todayKeyIn(timeZone), parsed)
              }}
            />
          </div>
        </PopoverContent>
      </Popover>

      {abbrev === undefined ? null : (
        <span className="shrink-0 text-xs text-muted-foreground">{abbrev}</span>
      )}

      {/* `size="icon-xs"` and a tighter row gap above, to buy the VALUE its width back.
          Once the trigger could actually shrink, the row's fixed chrome (the zone suffix,
          this button, two gaps) came out of the text rather than out of the container, and
          "May 12th, 2027 at 9:00 AM" on Event Details lost its last character to an
          ellipsis. Ref 03 transcribes that whole string, so the ~14px this reclaims is not
          cosmetic: it is the difference between showing the value and showing most of it.
          A clear affordance is also the smallest thing in the row by importance. */}
      {/* The 40x40 hit area comes from a pseudo-element, NOT from a bigger button, because
          the paragraph above is the reason this one is 24px: growing it back takes the width
          straight out of the value again. An `::after` has no layout, so the target grows and
          the row does not.

          It does not collide. To the right there is nothing in the row, and the tightest
          caller is the two-column Add Abstract grid, whose 12px column gap absorbs the 8px
          this reaches. To the left the 4px gap holds the zone abbreviation, which is text; in
          the one arrangement where the trigger IS the left neighbour there is no value set,
          so this button is `disabled` and `disabled:pointer-events-none` means it has no hit
          area at all. Vertically the 8px it gains clears the >=12px between form rows. */}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Clear"
        className="hit-area"
        disabled={value === undefined}
        onClick={() => {
          onChange(undefined)
        }}
      >
        <XIcon />
      </Button>
    </div>
  )
}
