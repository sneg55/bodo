// What an email template looks like once the merge fields have been filled in. SPK-14.
//
// Five templates carry real merge tokens and the editor could show none of them resolved:
// `{{speaker.firstName}}` was a string in a textarea and stayed one until a speaker received
// the mail. An organizer rewording an acceptance email was therefore checking their prose
// and nothing else - not whether the greeting reads right, not whether their subject line
// interpolates, not whether the merge field they typed from memory is one that exists.
//
// IT RENDERS THROUGH `resolveTemplate`, the same function every trigger sends through, and
// that is the whole point rather than a convenience. `decision-preview.ts` makes the same
// argument for the Notify preview: a preview built from a second substitution path is a
// preview that can DISAGREE with the mail, which is worse than no preview because it would
// be believed. Everything the senders' resolution does, this inherits:
//
//   - a blank body falls back to the built-in one, so clearing the editor previews the
//     email that would actually go out and labels it as the built-in copy;
//   - a blank subject falls back on its own, independently of the body;
//   - markdown is converted first and the merge values substituted into the resulting HTML,
//     escaped, so a company called "Acme *Labs*" previews the way it will arrive;
//   - an unknown merge field THROWS, naming it. That is the failure this preview is most
//     useful for: `renderTemplate` raises `MAIL_MERGE_FIELD_UNKNOWN`, the caller shows it,
//     and the organizer fixes the typo before saving rather than after four hundred sends.
//
// WHAT IT DOES NOT PROVE, stated because a preview is believed: the context below populates
// every merge field `saveAdminTemplate` accepts, so a template that saves is a template that
// previews. It does not follow that every TRIGGER supplies all of them - the portal
// invitation deliberately has no submission (template-keys.ts), so a body naming
// `{{submission.title}}` previews here and would still fail for a speaker who has never
// submitted. Matching each trigger's own context instead would be a second copy of what the
// senders build, and its drift would show up as this refusing a template that works, which
// is the worse of the two failures.
//
// Pure and dependency-free apart from those two renderers, so all of it is tested directly
// (tests/comms-template-preview.test.ts) rather than through a page.

import { emailHtmlFromMarkdown } from '@/features/comms/markdown-email'
import { resolveTemplate } from '@/features/comms/resolve-template'
import { ADMIN_TEMPLATES, type AdminTemplateMeta } from '@/features/comms/template-keys'
import type { MergeContext } from '@/features/comms/templates'

/** A person the preview can address, in the shape both a `Speaker` and the sample fit. */
export type PreviewPerson = {
  firstName: string
  lastName: string
  email: string
  company?: string
}

/**
 * The stand-in, used only when the event's roster is empty.
 *
 * Named after nobody real and pointed at `example.com`, which is reserved for exactly this,
 * so a preview can never be mistaken for a message addressed to an actual person. The caller
 * says which of the two it got, and the dialog says so on screen.
 */
export const SAMPLE_PERSON: PreviewPerson = {
  firstName: 'Ada',
  lastName: 'Okafor',
  email: 'ada.okafor@example.com',
  company: 'Northwind Labs',
}

/**
 * Sample values for the fields a template may name that no roster can supply.
 *
 * EVERY field `mergeFields` knows about is populated, and that invariant is what makes the
 * preview trustworthy in the negative direction: `saveAdminTemplate` validates a body
 * against the same full set (template-write.ts `assertMergeFields`), so a template the save
 * would accept is a template this can render. Leave one of these out and the preview starts
 * refusing merge fields that work, which is the one way a preview can be actively harmful.
 */
const SAMPLE_SUBMISSION = {
  code: 'SESS-014',
  title: 'Evaluating agents in production',
  startsAt: 'Tuesday 12 May, 09:30',
  room: 'Hall B',
}
const SAMPLE_TASK = { title: 'Upload your headshot', dueAt: 'Friday 1 May' }
const SAMPLE_EVENT_STARTS_AT = 'Monday 11 May 2026'
const SAMPLE_EVENT_LOCATION = 'Lisbon'

export type PreviewEvent = {
  name: string
  slug: string
  startsAt?: string
  location?: string
}

export type TemplatePreviewInput = {
  /** Which template, for its built-in subject and body. The fallback half of the resolve. */
  meta: AdminTemplateMeta
  /** The subject as it stands in the editor, saved or not. */
  subject: string
  /** The body as it stands in the editor, saved or not. */
  bodyMarkdown: string
  /** The real event, so `{{event.name}}` resolves to the organizer's own event. */
  event: PreviewEvent
  /** A real person off the roster. Absent falls back to `SAMPLE_PERSON`. */
  recipient?: PreviewPerson
  /** Where `{{portalUrl}}` points for this template. See `previewLinkUrl`. */
  portalUrl: string
}

export type TemplatePreview = {
  readonly subject: string
  readonly html: string
  /** `template` when the editor's body produced this, `system` when the built-in one did. */
  readonly source: 'template' | 'system'
  /** The address the merge fields were resolved against. */
  readonly toEmail: string
  /** True when the roster supplied nobody and `SAMPLE_PERSON` was used. */
  readonly sampleRecipient: boolean
}

/**
 * The context a preview renders against: the real event, a real person where there is one,
 * and a sample for everything else.
 *
 * MIXED ON PURPOSE, and the caller labels it. An organizer checking a template wants to see
 * their own event's name, because that is half of what the subject line reads like. Nothing
 * else can be real: an invitation names no submission (the roster it goes to has people who
 * have never submitted anything), and a body naming `{{submission.title}}` still has to
 * render into something rather than refuse.
 *
 * A real person with no company on their record falls back to the sample company for the
 * same reason: an absent value is not a merge field, it is a hole `renderTemplate` would
 * throw on, and throwing there would tell the organizer their template is broken when it is
 * the ROSTER ROW that is thin.
 */
export function previewMergeContext(input: TemplatePreviewInput): MergeContext {
  const person = input.recipient ?? SAMPLE_PERSON
  return {
    speaker: {
      firstName: nonEmpty(person.firstName) ?? SAMPLE_PERSON.firstName,
      lastName: nonEmpty(person.lastName) ?? SAMPLE_PERSON.lastName,
      email: nonEmpty(person.email) ?? SAMPLE_PERSON.email,
      company: nonEmpty(person.company) ?? SAMPLE_PERSON.company,
    },
    event: {
      name: input.event.name,
      slug: input.event.slug,
      startsAt: nonEmpty(input.event.startsAt) ?? SAMPLE_EVENT_STARTS_AT,
      location: nonEmpty(input.event.location) ?? SAMPLE_EVENT_LOCATION,
    },
    submission: SAMPLE_SUBMISSION,
    task: SAMPLE_TASK,
    portalUrl: input.portalUrl,
    // A sign-in link is minted per send and expires in fifteen minutes
    // (features/auth/magic-link.ts), so a preview cannot show a working one and must not
    // show a real one. It is here so a template naming the field renders rather than
    // refuses, which is the invariant above.
    magicLink: `${input.portalUrl}?token=sample-sign-in-link`,
  }
}

/**
 * Render one template as it stands in the editor.
 *
 * Throws `MAIL_MERGE_FIELD_UNKNOWN` from `renderTemplate` for a field the context cannot
 * supply, deliberately uncaught: the caller turns it into the message that names the field.
 */
export function previewTemplate(input: TemplatePreviewInput): TemplatePreview {
  const context = previewMergeContext(input)
  const resolved = resolveTemplate({
    // The editor's current text, handed over as the stored row would be. The ids are
    // placeholders: nothing reads them, because this resolve never produces an outbox row.
    stored: {
      id: 'preview',
      eventId: 'preview',
      key: input.meta.key,
      subject: input.subject,
      bodyMarkdown: input.bodyMarkdown,
      attachIcs: false,
    },
    fallback: {
      subject: input.meta.defaultSubject,
      // The built-in bodies are markdown and `CodeTemplate.html` is HTML, converted here
      // exactly as `decisionOutboxRows` and `inviteOutboxRows` convert theirs.
      html: emailHtmlFromMarkdown(input.meta.defaultBody),
      attachIcs: false,
    },
    context,
  })

  return {
    subject: resolved.payload.subject,
    html: resolved.payload.html,
    // There is no `form_inline` path here: this editor writes `EmailTemplates` rows, and the
    // only two answers to "where did this body come from" are the box above and the code.
    source: resolved.templateSource === 'template' ? 'template' : 'system',
    toEmail: context.speaker.email,
    sampleRecipient: input.recipient === undefined,
  }
}

/**
 * Where `{{portalUrl}}` points, per template.
 *
 * The merge context has one link slot and section 5.3 calls it `portalUrl`, but the two
 * groups fill it differently and always have: a speaker email links to the speaker portal
 * (`invite-actions.ts`, `decision-outbox.ts`), an admin alert links to the admin app's
 * Abstracts screen (`new-submission-alert.ts`). A preview that used one URL for both would
 * show organizers a link their alert does not contain.
 */
export function previewLinkUrl(
  meta: AdminTemplateMeta,
  appOrigin: string,
  eventId: string,
): string {
  const isAdminAlert = ADMIN_TEMPLATES.some((entry) => entry.key === meta.key)
  return isAdminAlert ? `${appOrigin}/admin/${eventId}/abstracts` : `${appOrigin}/portal`
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? undefined : trimmed
}
