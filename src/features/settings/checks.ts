// Event Details validation, and the slug-collision test.
//
// Separate from the Server Action so it can be unit tested without a base
// (tests/settings-checks.test.ts) and so the client form can show the same messages
// before it posts. Every rule here corresponds to something that breaks a live URL or an
// agenda render, and the reasons are on the rules themselves.
//
// Problems are returned as a list rather than thrown one at a time: the parity screen has
// four required fields and a save that reports them one per round trip is worse than the
// form it is cloning.

import {
  type EventDetailsDraft,
  isSlugShaped,
  NAME_MAX_LENGTH,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  THEME_MAX_LENGTH,
} from '@/features/settings/draft'

export type EventDetailsField =
  | 'name'
  | 'slug'
  | 'eventType'
  | 'websiteUrl'
  | 'location'
  | 'timezone'
  | 'startsAt'
  | 'endsAt'
  | 'theme'

/**
 * One refusal. There is deliberately no `severity`: every rule below blocks the save, so
 * a severity field would have one value and `hasBlockingProblem` would be a tautology the
 * type checker rejects. If an advisory ever appears, that is when the field earns its place.
 */
export type SettingsProblem = {
  readonly field: EventDetailsField
  readonly message: string
}

function error(field: EventDetailsField, message: string): SettingsProblem {
  return { field, message }
}

/**
 * True when `Intl` will accept this zone.
 *
 * The check is a constructor call rather than a list membership test, because the list
 * that matters is the runtime's: `Intl.supportedValuesOf` is not available everywhere and
 * a hardcoded list would reject zones the platform accepts. `Intl.DateTimeFormat` throws
 * `RangeError: Invalid time zone specified` on anything it does not recognise, which is
 * exactly the failure this guards (src/features/agenda/time.ts documents the outage).
 */
export function isValidTimezone(zone: string): boolean {
  const trimmed = zone.trim()
  if (trimmed === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed })
    return true
  } catch {
    return false
  }
}

/**
 * Loose on purpose. `Events.websiteUrl` shows as `ai.engineer` in ref 03, so requiring a
 * scheme would reject the value the real product stores. What is rejected is a value that
 * cannot be a host at all: whitespace, or no dot and no scheme.
 */
function websiteLooksLikeUrl(value: string): boolean {
  if (/\s/u.test(value)) return false
  if (value.includes('://')) {
    try {
      new URL(value)
      return true
    } catch {
      return false
    }
  }
  return value.includes('.') && !value.startsWith('.') && !value.endsWith('.')
}

export function checkEventDetails(draft: EventDetailsDraft): readonly SettingsProblem[] {
  return [
    ...checkName(draft),
    ...checkSlug(draft),
    ...checkWebsite(draft),
    ...checkTimezone(draft),
    ...checkDates(draft),
    ...checkTheme(draft),
  ]
}

function checkName(draft: EventDetailsDraft): readonly SettingsProblem[] {
  const name = draft.name.trim()
  if (name === '') return [error('name', 'Event Name is required.')]
  if (name.length > NAME_MAX_LENGTH) {
    return [error('name', `Event Name must be ${String(NAME_MAX_LENGTH)} characters or fewer.`)]
  }
  return []
}

function checkSlug(draft: EventDetailsDraft): readonly SettingsProblem[] {
  const slug = draft.slug.trim()
  if (slug === '') return [error('slug', 'Event Slug is required.')]
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return [
      error(
        'slug',
        `Event Slug must be between ${String(SLUG_MIN_LENGTH)} and ${String(SLUG_MAX_LENGTH)} characters.`,
      ),
    ]
  }
  if (!isSlugShaped(slug)) {
    return [
      error(
        'slug',
        'Event Slug can use lowercase letters, numbers and single hyphens between them, such as ai-engineer-sandbox.',
      ),
    ]
  }
  if (looksLikeRecordId(slug)) {
    return [
      error(
        'slug',
        'Event Slug cannot look like an Airtable record id. Add a hyphen, or change the length.',
      ),
    ]
  }
  return []
}

/**
 * The one slug an admin URL could not tell from a record id.
 *
 * `/admin/[eventId]` accepts either a record id or a slug and decides which it has by
 * matching `^rec[A-Za-z0-9]{14}$` (`src/features/events/event-ref.ts`). A slug is already
 * restricted to lowercase letters, digits and single hyphens, so the two can only collide on
 * a 17-character, all-lowercase, hyphen-free slug beginning `rec`. Such a slug would be read
 * as a record id, and the event would 404 at its own URL.
 *
 * Refusing it here is the second half of that pattern being anchored, and neither half works
 * alone: anchoring without this leaves the collision reachable, and this without anchoring
 * would still send `recordings` to Airtable as an id.
 */
function looksLikeRecordId(slug: string): boolean {
  return /^rec[a-z0-9]{14}$/.test(slug)
}

function checkWebsite(draft: EventDetailsDraft): readonly SettingsProblem[] {
  const value = draft.websiteUrl.trim()
  if (value === '' || websiteLooksLikeUrl(value)) return []
  return [error('websiteUrl', 'Event Website URL does not look like a web address.')]
}

function checkTimezone(draft: EventDetailsDraft): readonly SettingsProblem[] {
  if (isValidTimezone(draft.timezone)) return []
  return [error('timezone', 'Timezone must be a recognised IANA zone, such as America/New_York.')]
}

function checkDates(draft: EventDetailsDraft): readonly SettingsProblem[] {
  const problems: SettingsProblem[] = []
  const start = instantOf(draft.startsAt)
  const end = instantOf(draft.endsAt)

  if (draft.startsAt === undefined) problems.push(error('startsAt', 'Starts At is required.'))
  else if (start === undefined) problems.push(error('startsAt', 'Starts At is not a valid date.'))

  if (draft.endsAt === undefined) problems.push(error('endsAt', 'Ends At is required.'))
  else if (end === undefined) problems.push(error('endsAt', 'Ends At is not a valid date.'))

  // Equal is allowed: a one-slot event is real, and the agenda's day range handles it.
  if (start !== undefined && end !== undefined && end < start) {
    problems.push(error('endsAt', 'Ends At must be on or after Starts At.'))
  }
  return problems
}

function instantOf(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? undefined : parsed
}

function checkTheme(draft: EventDetailsDraft): readonly SettingsProblem[] {
  if (draft.theme.length <= THEME_MAX_LENGTH) return []
  return [error('theme', `Theme must be ${String(THEME_MAX_LENGTH)} characters or fewer.`)]
}

export function hasBlockingProblem(problems: readonly SettingsProblem[]): boolean {
  return problems.length > 0
}

/** The message to show under one control, so the form does not have to filter inline. */
export function firstProblemFor(
  problems: readonly SettingsProblem[],
  field: EventDetailsField,
): SettingsProblem | undefined {
  return problems.find((problem) => problem.field === field)
}

/**
 * Whether another event already holds this slug.
 *
 * Pure, over a list the caller read, because the interesting case is the one an
 * uncached lookup cannot express on its own: the event being edited holds its OWN slug,
 * so a naive "does any row have this slug" refuses every save that does not change it.
 */
export function slugTaken(
  slug: string,
  selfId: string,
  others: readonly { id: string; slug: string }[],
): boolean {
  const wanted = slug.trim().toLowerCase()
  return others.some((event) => event.id !== selfId && event.slug.trim().toLowerCase() === wanted)
}
