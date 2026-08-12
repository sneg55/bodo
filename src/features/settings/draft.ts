// The Event Details form as one value, and the two conversions either side of it.
//
// A draft rather than a FormData shape, for the same reason the form builder has one:
// the page holds the whole edit in client state (a live `n / 1000` counter, a date-time
// picker that has to render a zone abbreviation next to the value it just set), and the
// Server Action then validates and writes exactly what it was handed. See
// docs/parity/event-config.md refs 03 and 04 for the control inventory.
//
// Every string is non-optional and empty means blank, deliberately: an `undefined` and
// an `''` reaching the write layer are two different instructions (leave the column
// alone versus clear it), and a form control cannot express the first one. The two dates
// ARE optional, because the parity screenshots show a clear `X` on both.

import type { Event } from '@/types/domain'

/** Hard cap on Theme, matching the `18 / 1000` counter in ref 03. */
export const THEME_MAX_LENGTH = 1000

/** Event Name is a text column and Airtable's single-line limit is generous; this is ours. */
export const NAME_MAX_LENGTH = 255

export const SLUG_MIN_LENGTH = 3
export const SLUG_MAX_LENGTH = 80

/**
 * The characters a slug may contain. This is the value that goes into
 * `/agenda/{eventSlug}` and `/submit/{eventSlug}/{formPublicId}`, so it is restricted to
 * what survives a URL without escaping and what `findByText` can quote safely (reads.ts
 * explains why an apostrophe there is worse than an error: Airtable ignores the filter
 * and hands back the whole table).
 *
 * Charset only, with the hyphen placement checked separately in `isSlugShaped`. The one
 * regex that expresses both (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) has a nested quantifier, which
 * `security/detect-unsafe-regex` rejects, and two plain checks are cheaper to read anyway.
 */
export const SLUG_CHARSET = /^[a-z0-9-]+$/u

/** Lowercase kebab case: the charset above, with no leading, trailing or doubled hyphen. */
export function isSlugShaped(slug: string): boolean {
  return (
    SLUG_CHARSET.test(slug) && !slug.startsWith('-') && !slug.endsWith('-') && !slug.includes('--')
  )
}

/**
 * The Event Type options. `Events.eventType` is a single select and this list is the
 * migration's (tables-core.ts), not a second opinion: sending a value the column does
 * not have is a 422 from Airtable. Only "Conference" is visible in ref 03, so the rest
 * are the base's vocabulary rather than transcribed copy.
 */
export const EVENT_TYPE_OPTIONS: readonly string[] = [
  'Conference',
  'Summit',
  'Workshop',
  'Webinar',
  'Meetup',
  'Hackathon',
]

export type EventDetailsDraft = {
  name: string
  slug: string
  eventType: string
  websiteUrl: string
  location: string
  timezone: string
  /** ISO instant, or undefined for cleared. Required on save; see checks.ts. */
  startsAt: string | undefined
  endsAt: string | undefined
  theme: string
  logoUrl: string
  backgroundUrl: string
}

export function draftFromEvent(event: Event): EventDetailsDraft {
  return {
    name: event.name,
    slug: event.slug,
    eventType: event.eventType,
    websiteUrl: event.websiteUrl ?? '',
    location: event.location ?? '',
    timezone: event.timezone,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    theme: event.theme ?? '',
    logoUrl: event.logoUrl ?? '',
    backgroundUrl: event.backgroundUrl ?? '',
  }
}

/**
 * What the write layer receives: trimmed, with blanks turned into `null`.
 *
 * `null` and not `undefined`, because `compact()` in to-fields.ts drops `undefined`
 * keys as "leave this column alone". Clearing the website URL has to send something.
 */
export type EventDetailsWrite = {
  name: string
  slug: string
  eventType: string
  websiteUrl: string | null
  location: string | null
  timezone: string
  startsAt: string | null
  endsAt: string | null
  theme: string | null
  logoUrl: string | null
  backgroundUrl: string | null
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function toEventDetailsWrite(draft: EventDetailsDraft): EventDetailsWrite {
  return {
    name: draft.name.trim(),
    slug: draft.slug.trim().toLowerCase(),
    eventType: draft.eventType,
    websiteUrl: blankToNull(draft.websiteUrl),
    location: blankToNull(draft.location),
    timezone: draft.timezone.trim(),
    startsAt: draft.startsAt ?? null,
    endsAt: draft.endsAt ?? null,
    theme: blankToNull(draft.theme),
    logoUrl: blankToNull(draft.logoUrl),
    backgroundUrl: blankToNull(draft.backgroundUrl),
  }
}
