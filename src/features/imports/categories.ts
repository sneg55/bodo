// Sessionize category titles to bodo concepts. Pure. BUILD_SPEC 5.0e, trap 4.
//
// TRAP 4 in one line: Sessionize categories are USER-NAMED and untyped beyond
// `session` / `speaker`. The demo event's are `Session format`, `Track`, `Level` and
// `Language`, and nothing in the payload guarantees a single one of those names, so
// nothing here may read a title as a type.
//
// Everything below produces a SUGGESTION. The organizer confirms each one in the
// wizard's mapping step, and `targetFor()` returns undefined for anything unconfirmed
// rather than falling back to the guess. That asymmetry is the whole point of the file:
// a wrong guess applied silently turns an event's Track taxonomy into tags, or drops a
// category entirely, and the organizer finds out after the run has written everything.

import type { ImportCategoryPreview, ImportCategoryTarget, ImportMapping } from '@/types/imports'

/**
 * Ordered, and the order is load-bearing. `Session format` contains both "session" and
 * "format", and `Session type` contains "type": matching "type" before "format" sends
 * every format category to the wrong concept. Longest and most specific first.
 */
const TITLE_RULES: readonly {
  readonly match: readonly string[]
  readonly target: ImportCategoryTarget
}[] = [
  { match: ['session format', 'format'], target: 'format' },
  { match: ['track', 'topic', 'theme'], target: 'track' },
  { match: ['level', 'difficulty', 'experience', 'audience level'], target: 'level' },
  { match: ['language', 'spoken language'], target: 'language' },
  { match: ['session type', 'type'], target: 'format' },
  { match: ['tag', 'keyword'], target: 'tag' },
]

/** What an unmatched category defaults to, per its Sessionize type. */
export const DEFAULT_SESSION_TARGET: ImportCategoryTarget = 'tag'

/**
 * Speaker-type categories default to `ignore` rather than `tag`. bodo has no speaker
 * taxonomy: a Speaker record carries no tags and no track, so importing one as a tag
 * would attach a speaker's attribute to whichever session happened to reference it.
 */
export const DEFAULT_SPEAKER_TARGET: ImportCategoryTarget = 'ignore'

export type CategoryInput = {
  id: string
  title?: string | null
  type?: 'session' | 'speaker' | null
  items?: readonly unknown[]
}

/**
 * The guess, and only ever the guess. Matching is on a lowercased, whitespace-collapsed
 * title so `Session  Format` and `session format` agree; substring rather than equality
 * because organizers write `Track / Topic` and `Primary Track`.
 */
export function suggestCategoryTarget(
  title: string | null | undefined,
  type?: 'session' | 'speaker' | null,
): ImportCategoryTarget {
  if (type === 'speaker') return DEFAULT_SPEAKER_TARGET

  const normalized = (title ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (normalized === '') return DEFAULT_SESSION_TARGET

  for (const rule of TITLE_RULES) {
    if (rule.match.some((needle) => normalized.includes(needle))) return rule.target
  }
  return DEFAULT_SESSION_TARGET
}

/** The rows the wizard's mapping step renders, one `Select` each. */
export function previewCategories(
  categories: readonly CategoryInput[],
): readonly ImportCategoryPreview[] {
  return categories.map((category) => ({
    id: category.id,
    title: category.title ?? '',
    itemCount: category.items?.length ?? 0,
    suggested: suggestCategoryTarget(category.title, category.type),
  }))
}

/**
 * Pre-fills the mapping the organizer is about to confirm.
 *
 * Deliberately NOT what the import reads. This exists to populate the `Select`s so the
 * common case is a glance and a click, and the value only becomes real once the wizard
 * submits it. `targetFor()` is what the run consults, and it does not fall back to this.
 */
export function suggestedMapping(categories: readonly CategoryInput[]): ImportMapping {
  const entries = previewCategories(categories).map((row) => [row.id, row.suggested] as const)
  return { categories: Object.fromEntries(entries) }
}

/**
 * The confirmed choice, or undefined when the organizer has not made one.
 *
 * Undefined and not `DEFAULT_SESSION_TARGET`: the caller has to decide what an
 * unconfirmed category means, and in `normalize.ts` it means ignored plus a warning
 * naming the category. Returning a guess here is exactly the silent application this
 * file exists to prevent.
 */
export function targetFor(
  mapping: ImportMapping,
  categoryId: string,
): ImportCategoryTarget | undefined {
  return categoryLookup(mapping).get(categoryId)
}

/** A Map, because indexing a record with a runtime id is an object-injection sink. */
function categoryLookup(mapping: ImportMapping): ReadonlyMap<string, ImportCategoryTarget> {
  return new Map(Object.entries(mapping.categories))
}

/** True when every category the payload carries has a confirmed target. The wizard's
 * mapping step cannot advance until this holds, which is what makes the step real. */
export function isMappingComplete(
  mapping: ImportMapping,
  categories: readonly CategoryInput[],
): boolean {
  const lookup = categoryLookup(mapping)
  return categories.every((category) => lookup.has(category.id))
}
