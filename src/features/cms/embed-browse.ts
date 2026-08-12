// Keyword search and facet inventories for a served embed. R9, EMB-02/03/07.
//
// Pure and total, so the rules can be tested without a DOM: `EmbedViewState` owns the state
// and calls these, and this file owns what the words mean.
//
// SEARCH MATCHES TITLES AND SPEAKER NAMES, which is the rubric's own wording and also the
// only reading that is any use. A visitor typing "okafor" into a conference agenda is
// looking for a person, not for a session with her surname in the title, and a title-only
// search answers that with nothing while the speaker is right there on the card.
//
// The description is matched too. It costs nothing, it is already on the card, and a
// visitor who half-remembers a phrase from an abstract has nowhere else to type it.
//
// EVERY TERM MUST MATCH, and each may match any field. So "ada retrieval" finds Ada's talk
// about retrieval rather than every session by Ada plus every session about retrieval, which
// is what a single-string substring test would do and is not what anyone means by typing two
// words. Matching is case- and accent-insensitive, because a roster of international
// speakers is exactly where "jose" failing to find "José" is a bug rather than a nicety.

/** What matching reads. `PublicSession` satisfies it. */
export type SearchableSession = {
  title: string
  speakers: readonly string[]
  description?: string
}

/**
 * What the whole narrowing reads off one row, day included.
 *
 * `dayKey` is carried on the SESSION rather than passed beside it, because the day heading and
 * the row under it have to agree about which day they belong to. They did not: a heading was
 * server-rendered per day and only the rows inside it were narrowed, so `TUE` printed an empty
 * `Mon, October 12, 2026` band above its content and My Schedule printed a `Tue` band under two
 * starred Monday sessions. One list of sessions that each know their day is what lets the
 * heading ask the same question its rows do.
 */
export type NarrowableSession = SearchableSession & {
  id: string
  track?: string
  room?: string
  /** Already labelled for display, so the facet and the chip on the card read identically. */
  format?: string
  /** A `PublicScheduleDay.key`. Absent in the flat Session List, which has no day headings. */
  dayKey?: string
}

/**
 * A narrowable session plus the instants an .ics export needs: the whole of what crosses into
 * the browser for one session.
 *
 * Deliberately not the projected session. `people`, the pre-formatted `time` and the speaker job
 * titles are rendering data the SERVER already used, and shipping them again would put every
 * abstract on the wire twice. `CalendarSession` is a subset of this, so the export reads it
 * directly.
 */
export type BrowsableEmbedSession = NarrowableSession & {
  startsAt?: string
  endsAt?: string
}

/** Everything the visitor has narrowed by, in one value. `EmbedViewStateValue` satisfies it. */
export type EmbedNarrowing = {
  onlyMine: boolean
  scheduled: readonly string[]
  /** A `PublicScheduleDay.key`, or undefined for every day. */
  day?: string
  tracks: readonly string[]
  rooms: readonly string[]
  formats: readonly string[]
  query: string
}

/**
 * The ids still showing, as one set.
 *
 * Computed over the WHOLE list in one place rather than per row, which is what makes an empty
 * day heading impossible to reintroduce: the heading, the row and the "nothing matched" line all
 * read this one answer instead of each re-deriving it from the controls.
 *
 * The six conditions are ANDed, which is what a visitor means by combining controls, and ORed
 * within a facet, which is what they mean by ticking two tracks. That is the same reading
 * `@/features/cms/filters` gives the organizer's own filters, and the two agreeing matters: a
 * visitor who ticks two tracks and sees nothing reads it as broken data rather than as a filter
 * they set.
 */
export function visibleEmbedSessionIds(
  sessions: readonly NarrowableSession[],
  narrowing: EmbedNarrowing,
): ReadonlySet<string> {
  const visible = new Set<string>()
  for (const session of sessions) {
    if (narrowingAdmits(session, narrowing)) visible.add(session.id)
  }
  return visible
}

function narrowingAdmits(session: NarrowableSession, narrowing: EmbedNarrowing): boolean {
  if (narrowing.onlyMine && !narrowing.scheduled.includes(session.id)) return false
  // Every row in a day-grouped view carries a `dayKey`, the undated bucket included
  // (`UNDATED_DAY_KEY`), so this compares like with like. The flat Session List carries none,
  // and it offers no day tabs either, so `day` is never set while it is on screen.
  if (narrowing.day !== undefined && session.dayKey !== narrowing.day) return false
  if (!inFacet(narrowing.tracks, session.track)) return false
  if (!inFacet(narrowing.rooms, session.room)) return false
  if (!inFacet(narrowing.formats, session.format)) return false
  return matchesEmbedQuery(session, narrowing.query)
}

/**
 * An empty facet does not restrict; a non-empty one admits only its members.
 *
 * A session with NO value on a filtered dimension is excluded, matching the organizer-side rule:
 * an untracked session cannot satisfy "track is Agents", and admitting it would drop every
 * unlabelled session into every track-filtered view.
 */
function inFacet(selected: readonly string[], value: string | undefined): boolean {
  if (selected.length === 0) return true
  return value !== undefined && selected.includes(value)
}

/**
 * Case- and accent-folded, for comparison only.
 *
 * NFD splits an accented character into its base plus a combining mark, and the range strip
 * then removes the marks, so "José" and "Jose" fold to the same string. The folded value is
 * never rendered: it exists to be compared and then thrown away.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * The description is MARKUP, so its tags are stripped before it joins the haystack.
 *
 * Left in, a query of "p" or "strong" would match every session that has a description at
 * all, and a phrase the visitor half-remembers would fail to match the moment a tag fell
 * inside it. Only the description needs this; a title and a speaker name are plain strings.
 */
function prose(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

export function matchesEmbedQuery(session: SearchableSession, query: string): boolean {
  const terms = fold(query)
    .split(/\s+/u)
    .filter((term) => term !== '')
  if (terms.length === 0) return true

  // One haystack per session rather than per field, since a term may match anywhere. Built
  // per call and not memoised: an embed renders tens of sessions, not thousands, and a cache
  // keyed on a mutable row is a staleness bug waiting for the first organizer edit.
  const haystack = fold(
    [session.title, ...session.speakers, prose(session.description ?? '')].join(' '),
  )
  return terms.every((term) => haystack.includes(term))
}

/**
 * The distinct values a facet can offer, in the order the sessions present them.
 *
 * Built from the RENDERED sessions rather than from the event's full track and room lists,
 * and that is the important part: a filter offering a track with nothing in it is a control
 * that can only ever produce an empty list, which a visitor reads as broken. What is on
 * screen is what can be narrowed to.
 *
 * Sorted, so the control does not reshuffle when the first session changes.
 */
export function embedFacetValues<T>(
  sessions: readonly T[],
  valueOf: (session: T) => string | undefined,
): readonly string[] {
  const seen = new Set<string>()
  for (const session of sessions) {
    const value = valueOf(session)
    if (value !== undefined && value !== '') seen.add(value)
  }
  return [...seen].toSorted((left, right) => left.localeCompare(right))
}

/** Tick or untick one value of a facet, keeping the inventory's order irrelevant. */
export function toggleFacetValue(selected: readonly string[], value: string): readonly string[] {
  return selected.includes(value)
    ? selected.filter((entry) => entry !== value)
    : [...selected, value]
}

/**
 * Has the visitor narrowed anything at all?
 *
 * Read by the result count, which says "13 sessions" when the whole programme is on screen and
 * "3 of 13 sessions" when it is not. Without the distinction a visitor who has narrowed to three
 * rows and a visitor whose event has three sessions read the same line.
 *
 * A query of spaces does not count, because `matchesEmbedQuery` admits everything for one: the
 * two have to agree or the count claims a narrowing that changed no rows.
 */
export function isEmbedNarrowed(narrowing: EmbedNarrowing): boolean {
  return (
    narrowing.onlyMine ||
    narrowing.day !== undefined ||
    narrowing.tracks.length > 0 ||
    narrowing.rooms.length > 0 ||
    narrowing.formats.length > 0 ||
    narrowing.query.trim() !== ''
  )
}

/**
 * What the count line reads.
 *
 * WHY THERE IS ONE AT ALL, and it is a filed defect rather than a nicety. Two eval agents on two
 * separate public surfaces reported that nothing visibly changed when they searched or filtered:
 * the list is long, the rows that left were off-screen, and the only feedback was rows appearing
 * and disappearing somewhere the visitor was not looking. A control whose effect you cannot see
 * is a control you assume is broken. The count is the one element that always moves.
 *
 * Pluralised on the TOTAL in both shapes, because the total is what the noun names: `1 of 13
 * sessions` is one survivor out of thirteen, and `0 of 1 session` is an event with one talk that
 * the current search misses. Pluralising on the visible count instead would print `1 of 13
 * session`.
 *
 * The noun is a parameter because the speaker roster counts speakers, not sessions, and it has
 * the same reported defect. It defaults to sessions so every existing call site reads the same.
 * Do not inline a second copy of this wording for a new surface: pass the noun.
 */
export function embedResultCountLabel(input: {
  /** Every row the view is rendering, before the visitor narrowed anything. */
  total: number
  /** How many survive the current search, facets, day and star filter. */
  visible: number
  narrowed: boolean
  /** What the rows ARE. Defaults to sessions. */
  noun?: { one: string; many: string }
}): string {
  const names = input.noun ?? { one: 'session', many: 'sessions' }
  const noun = input.total === 1 ? names.one : names.many
  return input.narrowed ? `${input.visible} of ${input.total} ${noun}` : `${input.total} ${noun}`
}
