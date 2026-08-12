// The Field Options section of ref 33's left pane. R9.
//
// Reference: docs/parity/external-references.md, "Embed Filters and Field Options", verbatim:
// "Choose fields for the Agenda, Speaker, and Session cards. Grey fields are required; blue fields
// are preselected and customizable."
//
// TRANSCRIBED from that: three card types and not one flat list, a REQUIRED tier rendered grey and
// not deselectable, and a PRESELECTED tier rendered in the accent colour that can be turned off.
//
// AUTHORED: the individual field names, because no public source enumerates them. They are not
// guessed either. Each one is the intersection of three things:
//
//   1. A field the embed views ALREADY RENDER (@/features/cms/EmbedViews). A checkbox for a field
//      no layout draws is a control nothing reads, which is the defect class this surface keeps
//      producing.
//   2. A field the reference's own API objects carry, from Sessionboard's developer docs: the
//      37-field Session object and the 30-field SessionSpeaker object.
//   3. A field OUR Airtable schema actually stores, so deselecting it changes the output and
//      selecting it has something to show.
//
// DELIBERATELY EXCLUDED, each for a stated reason rather than by silent omission:
//
//   - `email`, every `phone_*`, and every `address_*` from SessionSpeaker. A served embed renders
//     on a page this app does not control, to anybody. A speaker's mailing address and mobile
//     number are not selectable at any tier, and a "required" tier is not the place to argue about
//     it: they are absent from the inventory entirely so no stored blob can ever name one.
//   - `admin_url`. It is an authenticated internal URL; publishing it tells a stranger where the
//     organizer's console is.
//   - The social URLs (`linkedin_url`, `twitter_url` and the rest). Not private, and we do store
//     them, but no embed view renders one today, so offering them would be item 1 above.
//
// TWO EXCLUSIONS HAVE BEEN REVERSED, and the reasons are recorded rather than quietly deleted,
// because both were correct when they were written:
//
//   - `description`, on the session and agenda cards. The objection was that a session
//     description "lives inside `answersJson` keyed by whatever the form called it, so there is
//     nothing an embed could render deterministically". No longer true: `describeSessions`
//     (@/features/agenda/public-descriptions) resolves it by REGISTRY KEY, which is the same
//     lookup the organizer's own editor writes through, so the text a visitor reads and the text
//     an organizer edits are provably the same answer.
//   - `about`, the speaker biography. The objection was that no view rendered it. The speaker
//     detail a list entry or a gallery card opens now does, and a speaker detail with no bio is
//     a photo and a job title. The email and the phone stay out: those are contact details,
//     while a biography is copy written FOR the programme.
//
// Only the OPTIONAL keys are stored. The required tier comes from the inventory below, so a blob
// hand-edited in the Airtable UI cannot contradict "grey fields are required": `visibleEmbedFields`
// unions the required tier back in every time, which is the guarantee, not the disabled checkbox.

import {
  EMBED_CARD_TYPES,
  type EmbedCardType,
  type EmbedFieldOptions,
  type EmbedView,
} from '@/types/cms'

export type EmbedFieldSpec = {
  key: string
  /** The checkbox label. Our wording: no source captures these. */
  label: string
  /** Grey and not deselectable. */
  required: boolean
}

const field = (key: string, label: string): EmbedFieldSpec => ({ key, label, required: false })
const locked = (key: string, label: string): EmbedFieldSpec => ({ key, label, required: true })

/**
 * The inventory, per card.
 *
 * A `Map` rather than an object for the reason src/types/cms.ts gives: the key is a variable at
 * every call site, and a computed index on a record is what `security/detect-object-injection`
 * refuses.
 */
export const EMBED_CARD_FIELDS: ReadonlyMap<EmbedCardType, readonly EmbedFieldSpec[]> = new Map([
  // The Agenda card, which the Agenda and Schedule Itinerary views both draw. `time` is locked
  // with `title` because a day-grouped agenda whose rows carry no time is a list of names.
  [
    'agenda',
    [
      locked('title', 'Session title'),
      locked('time', 'Start and end time'),
      // `format` is LOCKED rather than preselected, and that is about stored blobs rather than
      // about how important a Format is. Only optional keys are stored, and `cardSelection`
      // drops any key it does not recognise, so an embed saved before this field existed carries
      // a selection array with no `format` in it. Optional, that reads as "the organizer turned
      // Format off" and every embed already in the base would render without it, which is the
      // gap this closes. Required, it is unioned back in every time.
      locked('format', 'Format'),
      field('speakers', 'Speakers'),
      field('track', 'Track'),
      field('room', 'Room'),
      field('description', 'Description'),
    ],
  ],
  // The Speaker card, drawn by Speaker List and Speaker Gallery. Only the name is locked: a
  // roster of headshots with no names is not a roster.
  [
    'speaker',
    [
      locked('name', 'Name'),
      field('headshot', 'Headshot'),
      field('tagline', 'Tagline'),
      field('company', 'Company'),
      field('sessions', 'Their sessions'),
      field('about', 'Biography'),
    ],
  ],
  // The Session card, drawn by the flat Session List. `date` is locked here and is not a field on
  // the Agenda card at all, because this view has no day headers: the row carries its own date or
  // nothing tells a reader when the session is.
  [
    'session',
    [
      locked('title', 'Session title'),
      locked('date', 'Date'),
      // Locked for the reason the Agenda card's entry gives.
      locked('format', 'Format'),
      field('time', 'Start and end time'),
      field('speakers', 'Speakers'),
      field('track', 'Track'),
      field('room', 'Room'),
      field('description', 'Description'),
    ],
  ],
])

/** The section headings in the panel, which the reference sentence names. */
const CARD_LABELS = new Map<EmbedCardType, string>([
  ['agenda', 'Agenda card'],
  ['speaker', 'Speaker card'],
  ['session', 'Session card'],
])

export function embedCardLabel(card: EmbedCardType): string {
  return CARD_LABELS.get(card) ?? card
}

export function embedCardFields(card: EmbedCardType): readonly EmbedFieldSpec[] {
  return EMBED_CARD_FIELDS.get(card) ?? []
}

/**
 * Which card a rendered view draws.
 *
 * The three-card split maps onto the five views exactly, which is the strongest evidence that the
 * reference's three card types are the right model: the two day-grouped views share a card, the
 * two rosters share a card, and the flat list has its own.
 */
export function cardTypeForView(view: EmbedView): EmbedCardType {
  switch (view) {
    case 'agenda':
    case 'schedule_itinerary':
      return 'agenda'
    case 'speaker_list':
    case 'speaker_gallery':
      return 'speaker'
    case 'session_list':
      return 'session'
  }
}

/** Every optional field on, per "blue fields are preselected". */
export function defaultEmbedFieldOptions(): EmbedFieldOptions {
  return {
    agenda: optionalKeys('agenda'),
    speaker: optionalKeys('speaker'),
    session: optionalKeys('session'),
  }
}

/**
 * What one card actually renders: the required tier plus the optional fields still selected.
 *
 * A `Set`, because every call site asks "is this field on" once per row.
 */
export function visibleEmbedFields(
  options: EmbedFieldOptions,
  card: EmbedCardType,
): ReadonlySet<string> {
  const selected = selectionFor(options, card)
  const visible = new Set<string>()
  for (const spec of embedCardFields(card)) {
    if (spec.required || selected.includes(spec.key)) visible.add(spec.key)
  }
  return visible
}

/** One checkbox. A required field cannot be turned off, whatever is asked. */
export function toggleEmbedField(
  options: EmbedFieldOptions,
  card: EmbedCardType,
  key: string,
  on: boolean,
): EmbedFieldOptions {
  const spec = embedCardFields(card).find((candidate) => candidate.key === key)
  if (spec === undefined || spec.required) return options

  const current = selectionFor(options, card)
  const next = on
    ? current.includes(key)
      ? current
      : [...current, key]
    : current.filter((entry) => entry !== key)
  return withSelection(options, card, next)
}

/**
 * A stored blob, made safe to read.
 *
 * Anything unrecognised falls back to the DEFAULTS rather than to nothing. That direction is
 * deliberate: this is read on a public page, and a cell somebody pasted into by hand must not
 * blank every card on the conference's own website. Unknown field names inside an otherwise valid
 * blob are dropped, so a hand-added `"email"` cannot make one appear.
 */
export function normalizeEmbedFieldOptions(raw: unknown): EmbedFieldOptions {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaultEmbedFieldOptions()
  }
  // Copied into a Map before any lookup, as records.ts does with Airtable field sets: this object
  // came off the wire, so indexing it with a variable key can read the prototype chain.
  const entries = new Map(Object.entries(raw))
  const defaults = defaultEmbedFieldOptions()

  return {
    agenda: cardSelection(entries.get('agenda'), 'agenda', defaults.agenda),
    speaker: cardSelection(entries.get('speaker'), 'speaker', defaults.speaker),
    session: cardSelection(entries.get('session'), 'session', defaults.session),
  }
}

function cardSelection(
  raw: unknown,
  card: EmbedCardType,
  fallback: readonly string[],
): readonly string[] {
  if (!Array.isArray(raw)) return fallback
  const permitted = optionalKeys(card)
  // An explicitly empty array is honoured: it means every optional field off, which is a
  // legitimate configuration and must not be mistaken for a blank cell.
  return raw.filter(
    (entry): entry is string => typeof entry === 'string' && permitted.includes(entry),
  )
}

function optionalKeys(card: EmbedCardType): readonly string[] {
  return embedCardFields(card)
    .filter((spec) => !spec.required)
    .map((spec) => spec.key)
}

/** Exhaustive over `EMBED_CARD_TYPES`, so a fourth card is a type error rather than a no-op. */
function selectionFor(options: EmbedFieldOptions, card: EmbedCardType): readonly string[] {
  switch (card) {
    case 'agenda':
      return options.agenda
    case 'speaker':
      return options.speaker
    case 'session':
      return options.session
  }
}

function withSelection(
  options: EmbedFieldOptions,
  card: EmbedCardType,
  values: readonly string[],
): EmbedFieldOptions {
  switch (card) {
    case 'agenda':
      return { ...options, agenda: values }
    case 'speaker':
      return { ...options, speaker: values }
    case 'session':
      return { ...options, session: values }
  }
}

/** Every card, for the panel to iterate. Re-exported so the panel imports one module. */
export { EMBED_CARD_TYPES }
