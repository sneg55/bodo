// May this URL render a submission form at all?
//
// BUILD_SPEC section 5.1 is explicit that the route rejects anything that is not
// published, does not belong to the event named in the URL, or is past its close
// date, BEFORE rendering a single step. So the decision is one pure function that
// the page and the Server Action both call: a gate applied on the page only is
// decoration, because the action is an open POST that a closed page cannot stop.
//
// The open/closed half is `formPublicState` from the form types, not a second
// comparison of `closeDate` against the clock. Two implementations of "is this form
// open" is how a page renders a closed form or an action rejects an open one.

import type { Event } from '@/types/domain'
import type { Form } from '@/types/forms'
import { formPublicState } from '@/types/forms'

export const PublicFormReasons = {
  /** No form carries this publicId. */
  NOT_FOUND: 'not_found',
  /** The form exists but is still a draft in the builder. */
  NOT_PUBLISHED: 'not_published',
  /** The slug in the URL names a different event than the form belongs to. */
  WRONG_EVENT: 'wrong_event',
  /** Past the close date. */
  CLOSED: 'closed',
} as const

export type PublicFormReason = (typeof PublicFormReasons)[keyof typeof PublicFormReasons]

export type PublicFormGate = { open: true } | { open: false; reason: PublicFormReason }

/**
 * Slugs are compared case-insensitively and trimmed, because a link pasted into a
 * chat client comes back with a capital letter or a trailing space often enough
 * that treating it as a different event would be a support ticket, not security.
 */
function sameSlug(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

export function publicFormGate(input: {
  form: Pick<Form, 'status' | 'closeDate' | 'eventId' | 'kind'>
  event: Pick<Event, 'id' | 'slug'>
  /** The slug segment as it appeared in the URL. */
  eventSlug: string
  now: Date
}): PublicFormGate {
  const { form, event, eventSlug, now } = input

  // Both halves of "belongs to this event" are checked. The record link is what
  // the data says; the slug is what the URL claims. They agree in normal use, and
  // when they do not, the URL is wrong.
  if (form.eventId !== event.id || !sameSlug(event.slug, eventSlug)) {
    return { open: false, reason: PublicFormReasons.WRONG_EVENT }
  }

  // A task form is a portal surface, not a call for papers. Rendering one here
  // would expose an internal form on a public URL that nobody chose to publish.
  if (form.kind !== 'cfp') return { open: false, reason: PublicFormReasons.WRONG_EVENT }

  const state = formPublicState(form, now)
  if (state === 'draft') return { open: false, reason: PublicFormReasons.NOT_PUBLISHED }
  if (state === 'closed') return { open: false, reason: PublicFormReasons.CLOSED }
  return { open: true }
}

/**
 * Public-facing copy for a rejection. Deliberately vague about the difference
 * between a draft form and a URL that names the wrong event: a stranger holding a
 * guessed link learns nothing either way, and a speaker holding a real link needs
 * to be told to ask the organizer in both cases.
 *
 * The parity doc lists closed-state copy as an ambiguity (no screenshot captures
 * it), so this is the simplest wording that says what happened and what to do.
 */
export const PUBLIC_FORM_REJECTIONS: ReadonlyMap<
  PublicFormReason,
  { title: string; body: string }
> = new Map([
  [
    PublicFormReasons.CLOSED,
    {
      title: 'Submissions are closed',
      body: 'This call for papers is no longer accepting submissions. Contact the organizer if you think this is a mistake.',
    },
  ],
  [
    PublicFormReasons.NOT_PUBLISHED,
    {
      title: 'This form is not available',
      body: 'The organizer has not published this form yet. Ask them for a current link.',
    },
  ],
  [
    PublicFormReasons.WRONG_EVENT,
    {
      title: 'This form is not available',
      body: 'That link does not point at a form for this event. Ask the organizer for a current link.',
    },
  ],
  [
    PublicFormReasons.NOT_FOUND,
    {
      title: 'This form is not available',
      body: 'That link does not match any form. Ask the organizer for a current link.',
    },
  ],
])
