// The CMS embed domain type. Refs 32 and 33, docs/parity/cms-embeds.md, and for the three
// sections both of those screenshots caught collapsed, docs/parity/external-references.md.
//
// The vocabularies are IMPORTED from src/migrations/tables-cms.ts rather than restated
// here. They are the same list twice otherwise, and the copy that drifts is always the one
// the migration is not written against: a `view` value the app writes and Airtable rejects
// fails at the write, which is the one place an organizer cannot see what happened. This is
// the only import of `@/migrations` outside that directory, and it is deliberately one way.
//
// Style Options, Filters and Field Options now have columns. The earlier note here said they
// never could, on the grounds that both screenshots have those sections collapsed, and that
// reasoning is withdrawn: Sessionboard's public changelog carries the panel EXPANDED and its
// knowledge base describes the other two. What is transcribed and what is authored is recorded
// per control, next to each control, rather than in one paragraph here.
//
// The TYPES for the two blobs live here and the LOGIC over them lives in
// @/features/cms/filters and @/features/cms/field-options, which import these. One direction
// only, so `src/types` stays free of behaviour and there is no cycle to unpick.

import {
  EMBED_DATE_FORMATS,
  EMBED_FORMATS,
  EMBED_THEMES,
  EMBED_VIEWS,
} from '@/migrations/tables-cms'
import type { RecordId } from '@/types/domain'

export { EMBED_DATE_FORMATS, EMBED_FORMATS, EMBED_THEMES, EMBED_VIEWS }

export type EmbedFormat = (typeof EMBED_FORMATS)[number]
export type EmbedView = (typeof EMBED_VIEWS)[number]
export type EmbedTheme = (typeof EMBED_THEMES)[number]
export type EmbedDateFormat = (typeof EMBED_DATE_FORMATS)[number]

/**
 * The three card types Field Options covers.
 *
 * Transcribed: "Choose fields for the Agenda, Speaker, and Session cards." So it is three
 * groups rather than one flat list, and which group applies to a rendered view is decided by
 * `cardTypeForView` in @/features/cms/field-options.
 */
export const EMBED_CARD_TYPES = ['agenda', 'speaker', 'session'] as const
export type EmbedCardType = (typeof EMBED_CARD_TYPES)[number]

/**
 * Which fields an organizer has left switched ON, per card.
 *
 * Only the OPTIONAL fields are stored. A required field is required by the card's definition
 * (`EMBED_CARD_FIELDS`), so storing it would let a hand-edited Airtable cell contradict the
 * "grey fields cannot be deselected" rule the reference states.
 */
export type EmbedFieldOptions = Readonly<Record<EmbedCardType, readonly string[]>>

/**
 * The Filters section, as five independent sets.
 *
 * An EMPTY set means "do not restrict on this dimension", which is the only default that can be
 * right: a new embed has to serve the whole feed, and a filter set stored as "everything
 * currently defined" would silently stop matching the day a track was added.
 *
 * FIVE dimensions and no `statuses`, although the reference mentions one. @/features/cms/filters
 * carries the evidence: every row an embed can serve has already passed `publicAgendaRows`, and
 * `ACCEPTED_STATUSES` is `['accepted']`, so a status set could only narrow nothing or publish an
 * unaccepted session.
 */
export type EmbedFilters = {
  trackIds: readonly RecordId[]
  roomIds: readonly RecordId[]
  tagIds: readonly RecordId[]
  /** `Submissions.format`, a session format such as `talk`. Not `CmsEmbeds.format`. */
  formats: readonly string[]
  /** The language a session is DELIVERED in, per `Submissions.language`. */
  languages: readonly string[]
}

export type CmsEmbed = {
  id: RecordId
  eventId: RecordId
  /** Ref 32's card title. "New Embed" on creation. */
  name: string
  /**
   * What the public URL carries. Opaque for the same reason `Forms.publicId` is: the
   * snippet is pasted into somebody else's website, so it must never be a record id and
   * must not be guessable from the event slug.
   */
  publicId: string
  format: EmbedFormat
  view: EmbedView
  /** Ref 32's green pill and ref 33's toggle. False means the URL answers 404. */
  enabled: boolean

  // ── Style Options ─────────────────────────────────────────────────────────────────────────
  /** `Website Color Theme`. Captured value `Light`. */
  colorTheme: EmbedTheme
  /** `Primary Color`, as `#rrggbb`. Captured value `#1b6ec2`. */
  primaryColor: string
  /** `Date/Time Format`. The one captured option is `en_us_long`. */
  dateTimeFormat: EmbedDateFormat
  /**
   * `Extra CSS Code`. ALREADY SANITIZED by the time it is here.
   *
   * `mapCmsEmbed` runs it through `safeStoredEmbedCss`, so nothing downstream may assume this is
   * what the organizer typed, and nothing downstream needs to sanitize it again. Absent when the
   * cell is blank or when nothing in it survived.
   */
  extraCss?: string
  /**
   * `Extra CSS Code` exactly as the organizer typed it. NEVER render this.
   *
   * It exists because sanitizing on read made the sanitized value the only copy in the app, and
   * every write then carried it back to storage: a toggle of `Enabled` from the list page
   * rewrote the cell with the sanitized text, and for a stylesheet that sanitized to nothing
   * (`content: "\2192"` is refused, since a value may not contain a backslash) it CLEARED the
   * cell outright. So an unrelated one-field write destroyed organizer input. Found by Codex
   * review.
   *
   * The rule that follows: `extraCss` is what the public page renders, `extraCssRaw` is what the
   * editor shows and what a write round-trips. It reaches the admin editor's RSC payload, which
   * is that organizer's own input behind an admin check, and it must never reach the public
   * embed's projection.
   */
  extraCssRaw?: string

  // ── Filters and Field Options ─────────────────────────────────────────────────────────────
  filters: EmbedFilters
  fieldOptions: EmbedFieldOptions
}

// Maps rather than objects indexed by a variable key, because `security/detect-object-injection`
// warns on the latter and the lint-on-edit hook runs at zero warnings. Same lookup, and the
// fallback is a type requirement rather than a reachable branch: both maps are exhaustive over
// their union, so an unmapped value cannot be constructed.

/**
 * Ref 33's Format card title, and the label ref 32's "+ Add Embed" menu lists.
 *
 * `Styled HTML` is transcribed. The other four name what the format actually is at the URL, and
 * @/features/cms/format-options carries the extension, the content type and the body copy for
 * each: this map is only the name.
 */
const FORMAT_LABELS = new Map<EmbedFormat, string>([
  ['styled_html', 'Styled HTML'],
  ['basic_html', 'Basic HTML'],
  ['json', 'JSON'],
  ['xml', 'XML'],
  ['ical', 'iCal'],
])

export function embedFormatLabel(format: EmbedFormat): string {
  return FORMAT_LABELS.get(format) ?? format
}

/** The `items` prop Base UI's `Select` needs, so the closed trigger shows a label. */
export const EMBED_FORMAT_ITEMS: readonly { value: EmbedFormat; label: string }[] =
  EMBED_FORMATS.map((format) => ({ value: format, label: embedFormatLabel(format) }))

/** Ref 33's View selector, in the order the Format card's copy lists them. */
const VIEW_LABELS = new Map<EmbedView, string>([
  ['agenda', 'Agenda'],
  ['session_list', 'Session List'],
  ['schedule_itinerary', 'Schedule Itinerary'],
  ['speaker_list', 'Speaker List'],
  ['speaker_gallery', 'Speaker Gallery'],
])

export function embedViewLabel(view: EmbedView): string {
  return VIEW_LABELS.get(view) ?? view
}

/** The `items` prop Base UI's `Select` needs, or the closed trigger shows a raw value. */
export const EMBED_VIEW_ITEMS: readonly { value: EmbedView; label: string }[] = EMBED_VIEWS.map(
  (view) => ({ value: view, label: embedViewLabel(view) }),
)

/** `Website Color Theme`. `Light` is transcribed off the expanded panel; `Dark` is its pair. */
const THEME_LABELS = new Map<EmbedTheme, string>([
  ['light', 'Light'],
  ['dark', 'Dark'],
])

export function embedThemeLabel(theme: EmbedTheme): string {
  return THEME_LABELS.get(theme) ?? theme
}

export const EMBED_THEME_ITEMS: readonly { value: EmbedTheme; label: string }[] = EMBED_THEMES.map(
  (theme) => ({ value: theme, label: embedThemeLabel(theme) }),
)

/**
 * `Date/Time Format`.
 *
 * The first label is VERBATIM off the expanded panel, sample datetime and all, because that is
 * how the real control describes a format: by showing one. The second is authored in the same
 * shape so the two read as one list rather than as a transcription plus an afterthought.
 */
const DATE_FORMAT_LABELS = new Map<EmbedDateFormat, string>([
  ['en_us_long', 'English (US): Fri, June 3, 2022 at 11:00 PM'],
  ['iso', 'ISO 8601: 2022-06-03 23:00'],
])

export function embedDateFormatLabel(format: EmbedDateFormat): string {
  return DATE_FORMAT_LABELS.get(format) ?? format
}

export const EMBED_DATE_FORMAT_ITEMS: readonly { value: EmbedDateFormat; label: string }[] =
  EMBED_DATE_FORMATS.map((format) => ({ value: format, label: embedDateFormatLabel(format) }))

/** What a brand-new embed gets. `#1b6ec2` is the captured value in the expanded panel. */
export const EMBED_DEFAULTS = {
  colorTheme: 'light',
  primaryColor: '#1b6ec2',
  dateTimeFormat: 'en_us_long',
} as const satisfies Pick<CmsEmbed, 'colorTheme' | 'primaryColor' | 'dateTimeFormat'>
