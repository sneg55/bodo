'use client'

// A bare calendar date, as a `Calendar` inside a `Popover`. The shared control for every
// drawer that asks for a day with no time of day.
//
// WHY IT IS NOT AN `<Input type="date">`, which is what all three of its callers used. The
// native control's own "Show date picker" calendar DISMISSES THE SURROUNDING SHEET. Measured
// on the running app in the Add File Request drawer: opening the picker and clicking its
// next-month arrow toward May 2027 closed the whole panel with nothing saved and the request
// count unchanged, and typing into the segments was the only way through. The eval run of
// 2026-08-10 filed exactly that. The other two callers are the same control in the same kind
// of panel, so they had the same defect and only this one had been reported.
//
// The month and year DROPDOWNS are here for the same episode: a deadline a year out is a
// dozen presses of one arrow, which is what the organizer was doing when the panel vanished.
// `startMonth`/`endMonth` are what the year dropdown enumerates; without them
// react-day-picker offers a narrow window around today and it is back to the arrow.
//
// Distinct from `DateTimeField`, deliberately. That one works in ISO INSTANTS with a time of
// day, for a session's start and end. This one works in a bare `YYYY-MM-DD` key that the
// action resolves into the EVENT's zone, which is what a deadline means: end of that day
// where the conference is, not where the organizer happens to be sitting.

import { CalendarIcon, XIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatAgendaDate } from '@/features/agenda/time'
import { dateKeyOf, dateKeyValue } from '@/utils/date-key'

/**
 * What the year dropdown offers: one year back, five forward.
 *
 * Asymmetric because these dates are in the future and the year back is only there for
 * something being recorded late. Computed at module scope, which is a constant per isolate
 * and not mutable state used as a cache: nothing is stored from it, so an isolate living
 * across New Year offering one stale year is not worth a render-time clock read.
 */
const YEAR_RANGE = {
  start: new Date(new Date().getFullYear() - 1, 0, 1),
  end: new Date(new Date().getFullYear() + 5, 11, 31),
}

/**
 * The month the grid should be showing: the value's own, or this one when there is none.
 *
 * A `Date` at noon, like `dateKeyValue`, so no zone offset can roll it into a neighbouring
 * day and therefore a neighbouring month.
 */
function monthOf(value: string): Date {
  return dateKeyValue(value) ?? new Date()
}

export type DateKeyFieldProps = {
  id: string
  /** A date key, `YYYY-MM-DD`, or the empty string for none. */
  value: string
  onChange: (value: string) => void
  /** What the trigger reads when nothing is set. `No due date`, `No date`. */
  emptyLabel: string
  /**
   * Whether to offer the clear button. False where the date is REQUIRED, as it is when
   * scheduling a session: a control that can empty a required field is a way to fail the
   * form rather than a way out of it.
   */
  clearable?: boolean
  /** For the clear button's accessible name, since one page can hold two of these. */
  clearLabel?: string
}

export function DateKeyField({
  id,
  value,
  onChange,
  emptyLabel,
  clearable = true,
  clearLabel = 'Clear date',
}: DateKeyFieldProps) {
  const [open, setOpen] = useState(false)
  // The DISPLAYED month, held here rather than inside react-day-picker. See
  // `monthOf` below: this is what makes the picker open on the date it is editing and
  // what makes the month and year dropdowns move the grid and hold.
  const [month, setMonth] = useState<Date>(() => monthOf(value))

  return (
    <div className="flex items-center gap-1.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Re-seeded on every open, not only at mount: the value changes under this
          // component (a sheet reused for another row, a clear, a pick), and a month state
          // from the last time it was open is how a picker comes back on the wrong year.
          if (next) setMonth(monthOf(value))
          setOpen(next)
        }}
      >
        <PopoverTrigger
          render={<Button id={id} variant="outline" className="flex-1 justify-start font-normal" />}
        >
          <CalendarIcon className="shrink-0 text-muted-foreground" />
          {/* Equal-width figures, because the day and the year both change under this label
              and proportional digits make the whole trigger label reflow as they do: the "1"
              is narrower than every other numeral, so 11 -> 12 December shifts the year. */}
          <span className="truncate tabular-nums">
            {value === ''
              ? emptyLabel
              : formatAgendaDate(value, { month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            // Cascades to the day grid and the year dropdown: a month grid is a table of
            // numbers, and proportional figures leave its columns unevenly weighted.
            className="tabular-nums"
            mode="single"
            autoFocus
            captionLayout="dropdown"
            startMonth={YEAR_RANGE.start}
            endMonth={YEAR_RANGE.end}
            // CONTROLLED, and both halves are the fix. react-day-picker decides its own
            // opening month as `month || defaultMonth || today` and never looks at
            // `selected` (helpers/getInitialMonth.js), so a picker holding an October date
            // opened on the current month and needed two next-month presses to get back to
            // its own value. And with the month uncontrolled, its dropdowns write to state
            // inside the calendar that a remount of this popover silently resets, which is
            // the "the selects read the new year but the grid stayed put" report. Owning
            // the month here means the grid and the two dropdowns read the same value:
            // `goToMonth` calls `onMonthChange`, that sets this state, and the calendar
            // renders from it.
            month={month}
            onMonthChange={setMonth}
            selected={dateKeyValue(value)}
            onSelect={(next) => {
              if (next === undefined) return
              onChange(dateKeyOf(next))
              // Closed on pick. A drawer this tall puts the calendar over the footer, so
              // leaving it up hides the button the organizer is heading for next.
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>

      {clearable ? (
        // 32px of button, 40px of target. The pseudo-element carries the extra 4px a side so
        // the row keeps its measured widths; the 6px gap to the trigger on the left is wider
        // than the 4px this reaches, and to the right this is the last thing in the row.
        <Button
          variant="ghost"
          size="icon"
          className="hit-area"
          aria-label={clearLabel}
          disabled={value === ''}
          onClick={() => onChange('')}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  )
}
