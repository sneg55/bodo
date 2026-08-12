// Ref 34's page header: the date kicker with the countdown, and the time-of-day greeting.
//
// Both are computed in the EVENT's timezone (home-view.ts), which is not a detail: on Workers
// `Date` and `Intl` are UTC, and an organizer in California looking at a Tokyo event must see
// the days left on the event's own calendar rather than a number that turns over at their
// midnight.
//
// The greeting's FIRST NAME is the only thing on this header that needs a read, and it is
// behind a `<Suspense>` boundary for exactly that reason: it is an Airtable round trip for one
// word, and the header is the first thing on the first screen of the product. The boundary's
// fallback is the same greeting without the name, so the page paints its greeting immediately
// and the name streams into it, rather than the whole header waiting on a courtesy.
//
// Nothing inside the boundary can redirect or 404 (`currentUserFirstName` swallows its own
// failures and answers `undefined`), which is the rule that has to hold here: on Workers a
// `redirect()` from inside a boundary produces no response at all and a `notFound()` returns
// HTTP 200 with the 404 body.

import { Suspense } from 'react'

import { currentUserFirstName } from '@/features/dashboard/home-reads'
import { dayKicker, greeting } from '@/features/dashboard/home-view'
import type { Event } from '@/types/domain'

type EventClock = Pick<Event, 'timezone'> & { startsAt?: string }

export function HomeHeader({
  event,
  eventId,
  now,
}: {
  event: EventClock
  eventId: string
  now: Date
}) {
  return (
    <header className="flex flex-col gap-1">
      {/* `tabular-nums` because the kicker is a countdown: the day number and the days-to-event
          count both change on their own, and proportional digits shift the words around them
          on the first line of the first screen. */}
      <p className="text-xs font-medium tracking-wide text-muted-foreground tabular-nums">
        {dayKicker(event, now)}
      </p>
      <h1 className="font-heading text-2xl font-semibold">
        {/* The same `now` on both sides of the boundary, so the greeting cannot say
            "Good morning" in the fallback and "Good afternoon" once the name lands. */}
        <Suspense fallback={greeting(event, now)}>
          <Greeting event={event} eventId={eventId} now={now} />
        </Suspense>
      </h1>
    </header>
  )
}

async function Greeting({
  event,
  eventId,
  now,
}: {
  event: EventClock
  eventId: string
  now: Date
}) {
  return <>{greeting(event, now, await currentUserFirstName(eventId))}</>
}
