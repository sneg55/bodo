// The slug a resource page is addressed by, and what happens when two want the same one.
//
// The slug is a path segment: `/portal/resources/<slug>`. That is the whole reason this
// is a validated vocabulary rather than "whatever the organizer typed". A segment with a
// slash in it addresses a different route, a segment with a percent escape means one
// thing before decoding and another after, and either would make the lookup on the
// portal side disagree with the value stored on the record. So the accepted alphabet is
// lowercase letters, digits, and single interior hyphens, and everything else is a
// rejection with a message rather than a silent rewrite.
//
// Collisions are resolved by suffix and not by refusal. `Resources.slug` is a plain text
// column with no uniqueness constraint (Airtable has none to offer), so two pages called
// "Venue" are a thing an organizer will do, and the second one has to get a working URL
// instead of an error it cannot act on. `uniqueSlug` is pure and takes the taken set,
// which is what makes it testable: the caller reads the event's existing slugs and hands
// them in.

/**
 * Long enough for a real page title, short enough that the suffix fits.
 *
 * Not a database limit: `slug` is a long-text-free text column. It is a URL-readability
 * limit, and it is enforced on validation so an organizer is told rather than having the
 * value silently truncated out from under the link they just copied.
 */
export const SLUG_MAX_LENGTH = 60

export type SlugResult = { ok: true; slug: string } | { ok: false; message: string }

/**
 * Apostrophes are DELETED rather than turned into a separator, so `Speaker's Guide`
 * becomes `speakers-guide` and not `speaker-s-guide`. Everything else that is not a
 * letter or a digit becomes a separator.
 */
const DROPPED = /['‘’"“”]+/g
const NON_ALNUM = /[^a-z0-9]+/g
const ALLOWED = /^[a-z0-9-]+$/

/**
 * A title to a candidate slug. Never throws, and may return an empty string.
 *
 * An empty result is a real answer, not a failure to signal: a title of `!!!` has no
 * usable characters, and inventing something for it would give the page a URL its author
 * cannot predict. The caller treats empty as "ask for a slug", which is what
 * `validateSlug` then reports.
 */
export function slugify(title: string): string {
  const collapsed = title.toLowerCase().replace(DROPPED, '').replace(NON_ALNUM, '-')
  return trimHyphens(collapsed.slice(0, SLUG_MAX_LENGTH))
}

/**
 * An organizer-typed slug, normalised, or a message naming what is wrong with it.
 *
 * Normalisation is deliberately limited to trimming and lowercasing. Anything else is
 * rejected rather than repaired, because a repair changes the URL without telling
 * anyone: `venue info` silently becoming `venue-info` is how a link in an email points
 * at a 404.
 */
export function validateSlug(input: string): SlugResult {
  const slug = input.trim().toLowerCase()

  if (slug === '') {
    return { ok: false, message: 'Enter a URL slug.' }
  }
  if (slug.length > SLUG_MAX_LENGTH) {
    return { ok: false, message: `Use ${SLUG_MAX_LENGTH} characters or fewer.` }
  }
  if (!ALLOWED.test(slug)) {
    return { ok: false, message: 'Use lowercase letters, numbers, and hyphens only.' }
  }
  if (slug.startsWith('-') || slug.endsWith('-') || slug.includes('--')) {
    return { ok: false, message: 'Hyphens must sit between words.' }
  }
  return { ok: true, slug }
}

/**
 * `desired`, or the first `desired-N` that nothing in `taken` holds.
 *
 * Counting starts at 2 so the first duplicate reads as the second page of that name,
 * and a gap is filled rather than skipped: with `venue` and `venue-3` taken the answer
 * is `venue-2`, because the numbering is not a sequence anybody depends on and the
 * shortest free URL is the better one.
 *
 * The base is shortened to leave room for the suffix, so the result still satisfies
 * `validateSlug`. Comparison is case-insensitive because every stored slug is lowercase.
 */
export function uniqueSlug(desired: string, taken: readonly string[]): string {
  const claimed = new Set(taken.map((slug) => slug.trim().toLowerCase()))
  if (!claimed.has(desired)) return desired

  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`
    const base = trimHyphens(desired.slice(0, SLUG_MAX_LENGTH - suffix.length))
    const candidate = `${base}${suffix}`
    if (!claimed.has(candidate)) return candidate
  }
}

function trimHyphens(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value.charAt(start) === '-') start += 1
  while (end > start && value.charAt(end - 1) === '-') end -= 1
  return value.slice(start, end)
}
