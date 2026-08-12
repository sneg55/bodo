// How a stored singleSelect value is written for a reader. R9.
//
// `Submissions.format` and `Submissions.language` are singleSelects whose choices are declared
// privately in src/migrations/tables-core.ts, so nothing in this feature has a label table to
// look a value up in. Both surfaces that show one (the organizer's Filters panel, and the Format
// on a public session card and its detail) therefore derive the label from the value itself.
//
// ONE function rather than one per surface, because the two must agree: the visitor's Format
// facet filters on the string the card printed, so a card reading `Talk` above a facet reading
// `talk` is two controls that cannot select each other.
//
// DISPLAY ONLY. The stored value is what gets written, filtered and compared server side; this is
// never round-tripped back into a record, so no second mapping of Format exists.

/**
 * `talk` becomes `Talk`, `lightning_talk` becomes `Lightning talk`.
 *
 * Anything already capitalised (`English`) is unchanged, so a vocabulary an organizer wrote in
 * title case is printed as they wrote it.
 */
export function embedChoiceLabel(value: string): string {
  const words = value.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
