// What crosses from a rendered embed into the browser, and nothing more.
//
// Split out of ./projection so that file stays inside the 300-line budget, and it is the right
// seam rather than an arbitrary one: everything in ./projection decides what to RENDER on the
// server, and this decides what the visitor's own controls need a copy of.
//
// ONE LIST, BUILT ONCE, handed to `EmbedViewStateProvider`. The two control bars, the star on
// each row, the day headings and the "nothing matched" line all read it from there. They used
// to be separate props carrying the same rows, which cost two copies of every abstract on the
// wire and, worse, left the day heading out of the list entirely: it was server-rendered per
// day while only the rows under it were narrowed, so `TUE` printed an empty
// `Mon, October 12, 2026` band above the Tuesday content.

import type { BrowsableEmbedSession } from '@/features/cms/embed-browse'
import type { EmbedBody } from '@/features/cms/projection'
import type { EmbedSession } from '@/features/cms/projection-days'

/**
 * Every session the rendered view is showing, reduced to what the browser needs.
 *
 * `dayKey` travels ON the session, so a heading can ask whether anything under it survived
 * without being handed its own copy of the rows. The flat Session List has no day headings and
 * no day tabs, so its rows carry none.
 *
 * The two roster views yield nothing, which is right rather than a gap: a speaker gallery is
 * not something a visitor searches by room or builds a schedule out of, and both bars render
 * nothing when the list is empty.
 */
export function browsableSessions(body: EmbedBody): readonly BrowsableEmbedSession[] {
  switch (body.view) {
    case 'agenda':
    case 'schedule_itinerary':
      return body.days.flatMap((day) =>
        day.sessions.map((session) => ({ ...browsable(session), dayKey: day.key })),
      )
    case 'session_list':
      return body.sessions.map((session) => browsable(session))
    case 'speaker_list':
    case 'speaker_gallery':
      return []
  }
}

/**
 * Every optional field has to stay ABSENT when it is absent, which is why each one is spread
 * rather than assigned: `format: undefined` on the wire makes `'format' in session` true, and
 * an explicit undefined is not the same as no value to a facet that tests membership.
 */
function browsable(session: EmbedSession): BrowsableEmbedSession {
  const { id, title, speakers, description, track, room, format, startsAt, endsAt } = session
  return {
    id,
    title,
    speakers,
    ...(description === undefined ? {} : { description }),
    ...(track === undefined ? {} : { track }),
    ...(room === undefined ? {} : { room }),
    ...(format === undefined ? {} : { format }),
    ...(startsAt === undefined ? {} : { startsAt }),
    ...(endsAt === undefined ? {} : { endsAt }),
  }
}
