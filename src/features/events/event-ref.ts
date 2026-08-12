// What the `[eventId]` segment is allowed to contain, and how it becomes a record id.
//
// The segment used to hold an Airtable record id and nothing else, so every admin URL read
// `/admin/recHnUyjJXap9POSM/submissions`. It now holds an event REF, which is either that
// record id or the event's slug, and `/admin/ai-engineer-worlds-fair/submissions` addresses
// the same event. Both keep working forever, deliberately: a rec-id URL may already be
// bookmarked, and there is no redirect to break it.
//
// **The pattern is anchored, and that is the whole safety argument.** A `startsWith('rec')`
// test would send a slug like `recordings` to Airtable as a record id and 404 an event that
// exists. Slugs are lowercase letters, digits and single hyphens
// (`isSlugShaped` in ../settings/draft.ts), and record ids are `rec` plus 14 mixed-case
// alphanumerics, so the only overlap left is a 17-character all-lowercase hyphen-free slug
// beginning `rec`. `checkSlug` in ../settings/checks.ts refuses to save one, which is the
// other half of this: neither half closes the hole on its own.
//
// **Why the lookup is injected.** The resolution rule is the part worth testing and it is
// pure; the read is `getEventBySlug`, which is already cached and already tagged on the
// slug, so a resolved ref costs nothing warm and a rec-id ref costs no read at all.

/**
 * An Airtable record id, exactly: `rec` and 14 more. Anchored at both ends, because the
 * question this answers is "is the WHOLE ref a record id", never "does it start like one".
 */
const RECORD_ID = /^rec[A-Za-z0-9]{14}$/

/** Whether `ref` is a record id rather than a slug. */
export function isEventRecordId(ref: string): boolean {
  return RECORD_ID.test(ref)
}

/**
 * The record id an event ref names, or `undefined` when no event holds that slug.
 *
 * A record id resolves to itself WITHOUT a read. That is not only an optimization: it is
 * what keeps every existing rec-id URL working even for an event whose slug has since
 * changed, and it keeps this off the hot path for anything that already holds an id.
 *
 * A slug that no event holds returns `undefined` rather than throwing, for the reason
 * `getEventBySlug` gives: the caller turns it into a 404 or a refusal, and which one it is
 * depends on the caller rather than on this rule.
 */
export async function resolveEventRefWith(
  ref: string,
  lookup: (slug: string) => Promise<{ id: string } | undefined>,
): Promise<string | undefined> {
  if (isEventRecordId(ref)) return ref
  const event = await lookup(ref)
  return event?.id
}
