// Resolving the public URL to something the wizard can be handed.
//
// The projection is the point of this file. `Form` carries `adminAlertOnNew`,
// `adminAlertOnUpdate`, `confirmationEmailHtml` and the routing rules with their
// internal track record ids. None of that is the submitter's business, and a client
// component prop is a public payload: it is serialised into the RSC stream and
// readable in the browser. So the page never passes a `Form` across the boundary,
// it passes this.
//
// Track routing therefore stays server-side, which it has to be anyway: the whole
// reason `routeToTrack` takes the fields is so routing cannot run off a stale hidden
// answer, and a client-computed track is an answer a client chose.

import { eventDateRange } from '@/features/events/choices'
import { blankToUndefined } from '@/features/forms/builder/text'
import {
  deadlineSentence,
  resolveSubmissionLimit,
  submissionLimitSentence,
} from '@/features/submissions/banner'
import {
  type PublicFormReason,
  PublicFormReasons,
  publicFormGate,
} from '@/features/submissions/gate'
import { getEvent, getFormByPublicId } from '@/services/airtable/queries'
import type { Event } from '@/types/domain'
import type { CrossFieldLimit, Form, FormField, ParticipantRoleRule } from '@/types/forms'

/** Everything the public wizard renders, and nothing else. */
export type PublicForm = {
  publicId: string
  eventSlug: string
  eventName: string
  /**
   * The event's own identity, for the Welcome step and the tab title.
   *
   * A public call for papers is often the first page somebody sees of a conference, and it
   * carried none of this: no name above the fold, no dates, no logo, and a generic
   * "Submit a session" in the tab. A speaker with three CFPs open could not tell which
   * event they were writing for.
   *
   * PRE-RENDERED, like `deadlineLine` and for the same reason: the range is formatted in
   * the EVENT's timezone, so the client needs neither the raw instants nor the zone, and
   * the server and the browser cannot disagree about it.
   */
  eventDateLine?: string
  eventLogoUrl?: string
  /** The INTERNAL name. Kept because it is the fallback when no external title is set. */
  name: string
  /**
   * The participant-facing title, which heads the Welcome step. Ref 16 shows it as the H1
   * above the organizer's welcome body, and the live page title was
   * `<event name> - Welcome to our event!`. Absent when the organizer has not written one,
   * and the step then renders no heading rather than an empty element.
   */
  externalTitle?: string
  /** Rail label overrides. Absent falls back to `WIZARD_STEP_LABELS`, which is verbatim. */
  welcomeHeading?: string
  abstractHeading?: string
  participantHeading?: string
  /** The heading and description above each step's questions. */
  abstractSectionTitle?: string
  abstractSectionHtml?: string
  participantSectionTitle?: string
  participantSectionHtml?: string
  entityKind: Form['entityKind']
  participantsEnabled: boolean
  welcomeHtml?: string
  successHtml?: string
  fields: readonly FormField[]
  participantFields: readonly FormField[]
  roles: readonly ParticipantRoleRule[]
  crossFieldLimits: readonly CrossFieldLimit[]
  /** Pre-rendered banner copy, so the client needs neither the raw date nor the zone. */
  deadlineLine?: string
  limitLine?: string
  autoRedirectToPortal: boolean
}

/**
 * `now` only decides whether the deadline sentence carries a year, and it is threaded from
 * the resolver rather than read here so the page and the Server Action, which share that
 * resolver, cannot disagree about the date across a midnight boundary.
 */
export function toPublicForm(form: Form, event: Event, now: Date = new Date()): PublicForm {
  const limit = resolveSubmissionLimit({
    formLimit: form.submissionLimit,
    eventLimit: event.submissionLimitPerUser,
  })
  return {
    publicId: form.publicId,
    eventSlug: event.slug,
    eventName: event.name,
    // Empty string means the event has no start date, which is a real state for an event
    // still being planned. Normalised to `undefined` so the step renders nothing rather
    // than an empty line, the same convention every other optional here follows.
    eventDateLine: blankToUndefined(eventDateRange(event.startsAt, event.endsAt, event.timezone)),
    eventLogoUrl: event.logoUrl,
    name: form.name,
    // The authored copy, passed through as stored. Absence is meaningful here and each
    // consumer falls back for itself, so nothing is defaulted on the way out: a form that
    // predates these columns has all eight empty and must still render a coherent page.
    externalTitle: form.externalTitle,
    welcomeHeading: form.welcomeHeading,
    abstractHeading: form.abstractHeading,
    participantHeading: form.participantHeading,
    abstractSectionTitle: form.abstractSectionTitle,
    abstractSectionHtml: form.abstractSectionHtml,
    participantSectionTitle: form.participantSectionTitle,
    participantSectionHtml: form.participantSectionHtml,
    entityKind: form.entityKind,
    participantsEnabled: form.participantsEnabled,
    welcomeHtml: form.welcomeHtml,
    successHtml: form.successHtml,
    fields: form.fields,
    participantFields: form.participantFields,
    // Only the roles the organizer enabled reach the browser. A disabled role is
    // not a choice the submitter has, and `validateParticipants` reports one that
    // arrives anyway, so shipping the full list would only invite it.
    roles: form.roles.filter((rule) => rule.enabled),
    crossFieldLimits: form.crossFieldLimits,
    deadlineLine:
      form.closeDate === undefined
        ? undefined
        : deadlineSentence(form.closeDate, event.timezone, now),
    limitLine: limit === undefined ? undefined : submissionLimitSentence(limit),
    autoRedirectToPortal: form.autoRedirectToPortal,
  }
}

/**
 * Discriminated on `open` at the top level rather than on a nested `gate.open`,
 * because TypeScript only narrows a union by a discriminant it can see on the union
 * itself: with the flag one level down, `if (!resolved.gate.open)` narrows nothing and
 * `resolved.publicForm` does not typecheck on the far side of it.
 */
export type ResolvedPublicForm =
  | { open: true; form: Form; event: Event; publicForm: PublicForm }
  | { open: false; reason: PublicFormReason }

/**
 * One read path for both the page and the Server Action, so neither can be open
 * while the other is closed.
 *
 * A missing form is a gate reason rather than a thrown error: the public URL is
 * something strangers paste, and an unhandled DATA_RECORD_NOT_FOUND on a public
 * page is a 500 where a card saying "ask the organizer for a current link" is the
 * honest answer.
 */
export async function resolvePublicForm(input: {
  publicId: string
  eventSlug: string
  now: Date
}): Promise<ResolvedPublicForm> {
  const form = await findForm(input.publicId)
  if (form === undefined) {
    return { open: false, reason: PublicFormReasons.NOT_FOUND }
  }

  const event = await getEvent(form.eventId)
  const gate = publicFormGate({ form, event, eventSlug: input.eventSlug, now: input.now })
  if (!gate.open) return { open: false, reason: gate.reason }

  return { open: true, form, event, publicForm: toPublicForm(form, event, input.now) }
}

async function findForm(publicId: string): Promise<Form | undefined> {
  try {
    return await getFormByPublicId(publicId)
  } catch {
    // The DAL throws DATA_RECORD_NOT_FOUND for an unknown publicId, which is an
    // ordinary answer here rather than a fault.
    return undefined
  }
}
