// The posted resource editor form, validated before anything is written.
//
// Pure and separate from ./actions.ts so the rules are unit tested directly rather than
// through a browser: what a blank title does, what an unusable slug does, how a slug
// collision is resolved, and which fields are allowed to be empty. The action calls this
// AFTER it has authorized, and writes only if it returns `ok`.
//
// Every value arrives as a string, because that is what a `<form>` posts. Nothing here
// trusts the client for anything but content: the event, the record id, and the
// organizer's capability are all resolved server-side in ./actions.ts.

import { slugify, uniqueSlug, validateSlug } from '@/features/resources/slug'
import type { Resource } from '@/types/resources'

export type ResourceFormField =
  | 'title'
  | 'slug'
  | 'bodyMarkdown'
  | 'embedHtml'
  | 'visibility'
  | 'order'

export type ResourceFormProblem = { field: ResourceFormField; message: string }

export type ResourceFormValues = {
  title: string
  slug: string
  /** Empty means "no body"; the action turns that into a cleared column. */
  bodyMarkdown: string
  /** Raw organizer markup, stored verbatim. Isolated at render, never sanitized. */
  embedHtml: string
  visibility: Resource['visibility']
  order: number
  /** PortalItems.enabled: whether a speaker may see the page at all. */
  enabled: boolean
}

export type ResourceFormResult =
  | { ok: true; values: ResourceFormValues }
  | { ok: false; problems: readonly ResourceFormProblem[] }

/** Airtable single-line text tops out well above this; it is a UI limit. */
export const TITLE_MAX_LENGTH = 255

/** Airtable long text caps at 100,000 characters, so a longer write would 422. */
export const LONG_TEXT_MAX_LENGTH = 100_000

export type PostedResource = {
  title?: string
  slug?: string
  bodyMarkdown?: string
  embedHtml?: string
  visibility?: string
  order?: string
  /** A checkbox or switch posts its name only when on. */
  enabled?: string
}

export function parseResourceForm(posted: PostedResource): ResourceFormResult {
  const problems: ResourceFormProblem[] = []
  const title = (posted.title ?? '').trim()
  const bodyMarkdown = posted.bodyMarkdown ?? ''
  const embedHtml = posted.embedHtml ?? ''

  if (title === '') problems.push({ field: 'title', message: 'Enter a title.' })
  if (title.length > TITLE_MAX_LENGTH) {
    problems.push({ field: 'title', message: `Use ${TITLE_MAX_LENGTH} characters or fewer.` })
  }
  pushIfTooLong(problems, 'bodyMarkdown', bodyMarkdown)
  pushIfTooLong(problems, 'embedHtml', embedHtml)

  // An empty slug field falls back to the title, which is what an organizer who never
  // touched the field means. It is validated either way, so a title with no usable
  // characters is still reported rather than silently stored as an unreachable page.
  const slug = validateSlug(orDefault(posted.slug, slugify(title)))
  if (!slug.ok) problems.push({ field: 'slug', message: slug.message })

  const order = parseOrder(posted.order)
  if (order === undefined) {
    problems.push({ field: 'order', message: 'Enter a whole number, 0 or greater.' })
  }

  const visibility = parseVisibility(posted.visibility)
  if (visibility === undefined) {
    problems.push({ field: 'visibility', message: 'Choose a visibility.' })
  }

  if (problems.length > 0 || !slug.ok || order === undefined || visibility === undefined) {
    return { ok: false, problems }
  }

  return {
    ok: true,
    values: {
      title,
      slug: slug.slug,
      bodyMarkdown,
      embedHtml,
      visibility,
      order,
      enabled: posted.enabled !== undefined && posted.enabled !== '',
    },
  }
}

/**
 * The slug the write should use, given what else exists on the event.
 *
 * `currentSlug` is excluded from the taken set, and that exclusion is the whole point:
 * without it, saving a page twice without touching its slug would walk it from `venue` to
 * `venue-2` to `venue-3`, breaking every link an organizer had already shared.
 */
export function resolveSlug(input: {
  desired: string
  taken: readonly string[]
  currentSlug?: string
}): string {
  const current = input.currentSlug?.trim().toLowerCase()
  const taken = input.taken.filter((slug) => slug.trim().toLowerCase() !== current)
  return uniqueSlug(input.desired, taken)
}

/** The editor's initial values, for both create and edit. */
export function resourceFormValues(input: {
  resource?: Resource
  enabled: boolean
  /** Used only for a new page, so a fresh one lands at the end of the list. */
  nextOrder: number
}): ResourceFormValues {
  const { resource } = input
  return {
    title: resource?.title ?? '',
    slug: resource?.slug ?? '',
    bodyMarkdown: resource?.bodyMarkdown ?? '',
    embedHtml: resource?.embedHtml ?? '',
    visibility: resource?.visibility ?? 'portal',
    order: resource?.order ?? input.nextOrder,
    enabled: input.enabled,
  }
}

function orDefault(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? fallback : trimmed
}

function pushIfTooLong(
  problems: ResourceFormProblem[],
  field: ResourceFormField,
  value: string,
): void {
  if (value.length > LONG_TEXT_MAX_LENGTH) {
    problems.push({
      field,
      message: `Use ${LONG_TEXT_MAX_LENGTH.toLocaleString('en-US')} characters or fewer.`,
    })
  }
}

/** A blank order field means 0, which puts a page first rather than rejecting the save. */
function parseOrder(value: string | undefined): number | undefined {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return 0
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 0) return undefined
  return parsed
}

function parseVisibility(value: string | undefined): Resource['visibility'] | undefined {
  if (value === undefined || value === '') return 'portal'
  return value === 'portal' || value === 'public' ? value : undefined
}
