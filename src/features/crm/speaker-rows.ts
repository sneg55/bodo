// The CRM directory's row model: one flat object per speaker, plus the two counts that
// make the surface a CRM rather than a roster.
//
// Same shape and the same reasons as `features/review/abstracts-rows.ts`. It crosses the
// server-to-client boundary, so the row IS the payload, and the joins (how many of your
// events this person is on, how many sessions they are cast in, which CRM tags they carry)
// happen once per read here rather than per cell in a renderer.
//
// Nothing here reads Airtable or the clock. Everything arrives as a lookup, so the rules
// below are assertable without a base (`tests/crm-speaker-rows.test.ts`).

import { speakerInitials as sharedInitials } from '@/features/speakers/initials'
import type { RowAccessors } from '@/features/views/table-query'
import type { SpeakerInEvents } from '@/types/crm'
import type { RecordId, Speaker, SpeakerTag } from '@/types/domain'

export type SpeakerRow = {
  readonly speaker: Speaker
  /** How many of the VIEWER'S events this speaker is on. Never the global number. */
  readonly eventCount: number
  /** Sessions in those same events. A speaker cast twice on one session counts once. */
  readonly sessionCount: number
  readonly tags: readonly SpeakerTag[]
}

/**
 * A person's display name, falling back to the email.
 *
 * Both name columns are optional on the Speakers row (`mapSpeaker` defaults them to ''),
 * and a CRM row rendering as blank is unclickable and unsearchable. The same fallback
 * `abstracts-rows.ts` applies to a submission's cast.
 */
export function speakerName(speaker: Speaker): string {
  const full = `${speaker.firstName} ${speaker.lastName}`.trim()
  return full.length > 0 ? full : speaker.email
}

/**
 * A biography is rich text, and it is flattened here rather than in the cell for the reason
 * `abstracts-rows.ts` gives about a description: a table row must never render
 * caller-supplied HTML. It also keeps a filter from matching on markup nobody typed.
 *
 * Flattened but NOT truncated, and that is the correction to how this shipped. Truncating
 * here meant the accessor a filter reads returned 160 characters, so `bio contains X` for
 * an X further into the biography silently matched nothing while looking like it worked.
 * The cell truncates for display instead (`speaker-columns.tsx`), which is where a length
 * limit belongs: it is a property of the column's width, not of the value.
 */
function plainText(html: string): string {
  return html
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

/**
 * A speaker's biography as text, for any CRM surface that shows it.
 *
 * Exported so the profile flattens it the same way the table does. It is NOT rendered
 * through `OrganizerHtml`, and the distinction that component's own header draws is the
 * reason: this markup is SPEAKER input, arriving through `mapSpeaker` with no sanitizer
 * at the read boundary, so putting it in a `dangerouslySetInnerHTML` on an admin screen
 * would make one speaker's biography a script in an organizer's session.
 */
export function speakerBioText(speaker: Speaker): string {
  return plainText(speaker.bio ?? '')
}

/**
 * `AO` for Ada Okafor, falling back to the first letter of whatever exists, then to `'?'`.
 *
 * This rule was the correct one of the four that existed, so it is the one
 * `@/features/speakers/initials` now holds for everybody. Re-exported under this name
 * because the directory's avatar cell and the profile header both import it from here and a
 * `Speaker` satisfies the shared helper's looser input type.
 */
export function speakerInitials(speaker: Speaker): string {
  return sharedInitials(speaker)
}

/**
 * Column key to the text a search, a filter or a sort compares against.
 *
 * A Map of accessors rather than `row[key]`: the key arrives from stored column
 * preferences or from the address bar, and a dynamic index into a plain object is what
 * `security/detect-object-injection` blocks the build over. It also means a key this
 * surface does not have is a miss (`undefined`) rather than an empty string, which is the
 * distinction `matchesFilters` needs: undefined means "this table cannot evaluate that
 * condition, keep the row", while '' means "the cell is genuinely empty".
 */
const TEXT_ACCESSORS: ReadonlyMap<string, (row: SpeakerRow) => string> = new Map([
  ['name', (row) => speakerName(row.speaker)],
  ['firstName', (row) => row.speaker.firstName],
  ['lastName', (row) => row.speaker.lastName],
  ['email', (row) => row.speaker.email],
  ['phone', (row) => row.speaker.phone ?? ''],
  ['company', (row) => row.speaker.company ?? ''],
  ['tagline', (row) => row.speaker.tagline ?? ''],
  ['pronouns', (row) => row.speaker.pronouns ?? ''],
  ['bio', (row) => speakerBioText(row.speaker)],
  ['headshot', (row) => row.speaker.headshotUrl ?? ''],
  ['tags', (row) => row.tags.map((tag) => tag.name).join(', ')],
  ['eventCount', (row) => String(row.eventCount)],
  ['sessionCount', (row) => String(row.sessionCount)],
])

export function speakerText(row: SpeakerRow, key: string): string | undefined {
  return TEXT_ACCESSORS.get(key)?.(row)
}

/** Numeric sort keys, so 9 does not sort after 10 the way its string form does. */
const NUMBER_ACCESSORS: ReadonlyMap<string, (row: SpeakerRow) => number | undefined> = new Map([
  ['eventCount', (row) => row.eventCount],
  ['sessionCount', (row) => row.sessionCount],
])

export function speakerNumber(row: SpeakerRow, key: string): number | undefined {
  return NUMBER_ACCESSORS.get(key)?.(row)
}

/**
 * Whether a column sorts numerically. Asked before reading a value rather than inferred
 * from one, for the reason `abstracts-rows.ts` gives: inferring makes the comparator
 * depend on whichever row it happens to see first.
 */
export function hasNumericSort(key: string): boolean {
  return NUMBER_ACCESSORS.has(key)
}

/** The columns the free-text box scans. Everything else needs a filter. */
export const SPEAKER_SEARCHABLE_KEYS: readonly string[] = ['name', 'email', 'company', 'tagline']

/**
 * The one MULTI-VALUED column here, so a filter compares against each tag rather than
 * against the joined cell.
 *
 * `TEXT_ACCESSORS` flattens tags to `AI, Infra`, which is right for the cell, for search and
 * for sort, and wrong for a filter: `Speaker Tags is AI` was false for a speaker carrying
 * the AI tag alongside another, so the answer excluded the rows it was asked for. Same list,
 * unjoined, rather than splitting that string back apart on a comma, which would break on
 * the first tag with a comma in its name.
 */
const LIST_ACCESSORS: ReadonlyMap<string, (row: SpeakerRow) => readonly string[]> = new Map([
  ['tags', (row: SpeakerRow) => row.tags.map((tag) => tag.name)],
])

export function speakerValues(row: SpeakerRow, key: string): readonly string[] | undefined {
  return LIST_ACCESSORS.get(key)?.(row)
}

/**
 * This surface's binding into the row-type-agnostic engine in `features/views/table-query.ts`.
 * The engine is shared with Abstracts; only these accessors differ.
 */
export const SPEAKER_ACCESSORS: RowAccessors<SpeakerRow> = {
  text: speakerText,
  numeric: hasNumericSort,
  number: speakerNumber,
  searchableKeys: SPEAKER_SEARCHABLE_KEYS,
  list: speakerValues,
}

/**
 * One event's session casts. What the Sessions count is computed from.
 *
 * Only the casts, because the OTHER half of the old shape (which speakers are on the
 * event) now arrives with the speaker itself: `listSpeakersInEvents` keeps the event links
 * that were already in the records it read, so the Events count needs no per-event read
 * and this type no longer carries a roster.
 */
export type SpeakerEventSessions = {
  readonly eventId: RecordId
  /** One entry per submission: the speaker ids in its cast. */
  readonly sessionCasts: readonly (readonly RecordId[])[]
}

/**
 * Sessions per speaker, across the viewer's events.
 *
 * Deduplicated within a cast, and that duplicate is a real case rather than a
 * hypothetical: the same person can hold two roles on one submission (presenter and
 * chairperson), and counting that as two sessions overstates every panel in the base.
 */
export function sessionCounts(
  activity: readonly SpeakerEventSessions[],
): ReadonlyMap<RecordId, number> {
  const sessions = new Map<RecordId, number>()
  for (const event of activity) {
    for (const cast of event.sessionCasts) {
      for (const speakerId of new Set(cast)) {
        sessions.set(speakerId, (sessions.get(speakerId) ?? 0) + 1)
      }
    }
  }
  return sessions
}

export type SpeakerRowLookups = {
  readonly sessionCounts: ReadonlyMap<RecordId, number>
  readonly tagsBySpeaker: ReadonlyMap<RecordId, readonly SpeakerTag[]>
}

/**
 * Rows in the reader's order, which is already sorted by last name (`listSpeakersInEvents`).
 *
 * The Events count is `eventIds.length` off the roster entry, which is the viewer's own
 * events and nobody else's, because the read intersected them with the scope. A speaker
 * the session lookup says nothing about reads zero rather than blank: no sessions in your
 * events is a fact about them, not missing data.
 */
export function buildSpeakerRows(
  speakers: readonly SpeakerInEvents[],
  lookups: SpeakerRowLookups,
): readonly SpeakerRow[] {
  return speakers.map(({ speaker, eventIds }) => ({
    speaker,
    eventCount: eventIds.length,
    sessionCount: lookups.sessionCounts.get(speaker.id) ?? 0,
    tags: lookups.tagsBySpeaker.get(speaker.id) ?? [],
  }))
}
