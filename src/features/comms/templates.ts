// Template rendering: a tiny `{{path}}` interpolator over a fixed context.
//
// Deliberately not a template language. An organizer writes email bodies, and a
// merge field that can call functions or reach arbitrary properties is a way for a
// stored string to read something it should not. So the only operation is "look up a
// dotted path in a context object I constructed", unknown fields are an error rather
// than an empty string, and nothing is evaluated.
//
// Unknown-field-is-an-error is the important half. A silent blank means an organizer
// sends four hundred emails that say "Hi ," and finds out from a speaker, so a bad
// merge field fails at render and the outbox row never gets written.

import { AppError, ErrorIds } from '@/constants/errorIds'

/** Everything a template may reference. Nothing else is reachable. */
export type MergeContext = {
  speaker: { firstName: string; lastName: string; email: string; company?: string }
  event: { name: string; slug: string; startsAt?: string; location?: string }
  submission?: { code: string; title: string; startsAt?: string; room?: string }
  task?: { title: string; dueAt?: string }
  portalUrl: string
  magicLink?: string
}

const FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

/**
 * Flattened once into a Map rather than walked per field. Two reasons: a dynamic
 * property read on a nested object is the injection sink the security lint objects
 * to, and a flat map makes "which fields exist" answerable, which is what lets the
 * builder validate a template before it is saved.
 */
export function mergeFields(context: MergeContext): ReadonlyMap<string, string> {
  const fields = new Map<string, string>()

  const put = (key: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') fields.set(key, value)
  }

  put('speaker.firstName', context.speaker.firstName)
  put('speaker.lastName', context.speaker.lastName)
  put('speaker.email', context.speaker.email)
  put('speaker.company', context.speaker.company)
  put('event.name', context.event.name)
  put('event.slug', context.event.slug)
  put('event.startsAt', context.event.startsAt)
  put('event.location', context.event.location)
  put('submission.code', context.submission?.code)
  put('submission.title', context.submission?.title)
  put('submission.startsAt', context.submission?.startsAt)
  put('submission.room', context.submission?.room)
  put('task.title', context.task?.title)
  put('task.dueAt', context.task?.dueAt)
  put('portalUrl', context.portalUrl)
  put('magicLink', context.magicLink)

  return fields
}

/**
 * Substitute every merge field. Throws on a field the context cannot supply, naming
 * it, so the failure is a fixable message rather than four hundred emails addressed
 * to nobody.
 */
export function renderTemplate(template: string, context: MergeContext): string {
  return substitute(template, context, escapeHtml)
}

/**
 * The same substitution WITHOUT HTML escaping, for a value that is not markup.
 *
 * There is exactly one such value and it is the subject line. A subject is a mail header,
 * so an event called "AI & ML Summit" must arrive as "AI & ML Summit" and not as
 * "AI &amp; ML Summit". Every sender in this codebase already interpolated its subject with
 * a template literal for that reason; this is what a subject STORED in
 * `EmailTemplates.subject` goes through instead, so an organizer's `{{event.name}}` resolves
 * and an unknown field still fails the render rather than mailing a gap.
 *
 * Deliberately not exported as a general-purpose "unescaped render". Nothing else may use
 * it: a body rendered through this would put a speaker's own abstract title into an HTML
 * email unescaped, which is the injection the escaping in `renderTemplate` exists to stop.
 */
export function renderSubject(template: string, context: MergeContext): string {
  return substitute(template, context, (value) => value)
}

function substitute(
  template: string,
  context: MergeContext,
  encode: (value: string) => string,
): string {
  const fields = mergeFields(context)
  const missing: string[] = []

  const rendered = template.replace(FIELD_PATTERN, (_match, path: string) => {
    const value = fields.get(path)
    if (value === undefined) {
      missing.push(path)
      return ''
    }
    return encode(value)
  })

  if (missing.length > 0) {
    throw new AppError(
      ErrorIds.MAIL_MERGE_FIELD_UNKNOWN,
      `template references fields the context cannot supply: ${missing.join(', ')}`,
      { missing },
    )
  }

  return rendered
}

/** Which fields a template uses, for validating one in the builder before saving. */
export function fieldsUsedBy(template: string): readonly string[] {
  // Group 1 always participates in a match for this pattern, so it is a string.
  return [...template.matchAll(FIELD_PATTERN)].map((match) => match[1])
}

/**
 * Values are escaped on the way in. A speaker controls their own name and their
 * abstract title, both of which land in an HTML email, so an unescaped merge is
 * stored markup executing in whatever client opens it.
 *
 * Exported for the one email in the product composed in code rather than from a template
 * (`features/team/invite-email.ts`, which interpolates an organizer-controlled event name).
 * A second private copy beside that composer is how the two drift, and the direction they
 * drift in is an escape that quietly stops covering a character.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
