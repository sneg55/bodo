// The Add File Request drawer's local state, and the rules for turning it into an input.
//
// Ref 31 IS captured, so unlike the Add Task drawer this shape is transcribed rather than
// inferred. Verbatim from it: the title `Add File Request`, the subtitle `Create a new file
// request for participants`, the info callout `Files are stored, not attached` with its body,
// the `Title` placeholder `e.g. Upload Presentation Slides`, the required `Type` cards
// (`Contacts` selected, `Groups` dimmed, `Submissions`), the `Instructions` editor with
// placeholder `Enter instructions...`, and a footer of `Cancel` plus `Create File Request`
// disabled until valid.
//
// TWO ADDITIONS, both flagged rather than passed off as parity: a `Required` switch and a
// `Due date` input. Neither is on ref 31. Both are columns the schema already carries
// (BUILD_SPEC 3: `FileRequests.required`, `FileRequests.dueAt`) and both are named in the
// build scope for this surface, and a request with no way to say "this one is mandatory by
// Friday" cannot drive the delivery table it feeds.
//
// Pure, and tested in tests/file-requests-draft.test.ts.

import type { TaskEntityType } from '@/constants/status'
import type { RecordId } from '@/types/domain'

/** Matches the registry's cap on a title column, and the drawer counts against it. */
export const REQUEST_TITLE_MAX = 255

export const INFO_CALLOUT = {
  heading: 'Files are stored, not attached',
  body: 'Uploaded files live on this File Request and can be downloaded or exported. They are not attached to the contact, group, or session record.',
} as const

export type RequestTypeCard = {
  entityType: TaskEntityType
  /** Ref 31's card labels, which are plural and audience-shaped. */
  label: string
}

/**
 * **`Groups` IS GONE** (2026-08-10), for the reason given in full on `PORTAL_FORM_TYPE_CARDS`:
 * ref 31 dims it, and a dimmed tile offered an entity type with no table in BUILD_SPEC 3,
 * switched off pending nothing. A control with nothing behind it is deleted.
 */
export const REQUEST_TYPE_CARDS: readonly RequestTypeCard[] = [
  { entityType: 'contact', label: 'Contacts' },
  { entityType: 'submission', label: 'Submissions' },
]

export type RequestDraft = {
  title: string
  entityType: TaskEntityType
  /** HTML, because the Instructions control is a rich text editor. */
  instructionsHtml: string
  required: boolean
  /** A date key, `YYYY-MM-DD`, in the event's zone. Empty when there is no deadline. */
  dueAt: string
  /** Whether saving also fans the request out to the accepted speakers. */
  requestFromAccepted: boolean
}

export const EMPTY_REQUEST_DRAFT: RequestDraft = {
  title: '',
  // Ref 31 preselects Contacts, and it is also the safe default: a contact request needs
  // nothing but a speaker, so it cannot be created in a state that assigns to nobody.
  entityType: 'contact',
  instructionsHtml: '',
  // Ref 31 has no such control, so there is no captured default. On rather than off, because
  // an organizer asking for a document is asking for it, and the effect of being wrong is a
  // chase-list entry rather than a blocked speaker.
  required: true,
  dueAt: '',
  // ON, and this is the third addition to ref 31. Creating a request used to assign it to
  // nobody and say nothing about it: the drawer closed, the new card read "Not requested
  // from anybody yet", and the request reached no portal until somebody separately found
  // "Request from accepted speakers" in the card's kebab. A file request that collects
  // nothing is the one outcome an organizer cannot detect, because the screen looks the
  // same as one nobody has answered yet. The switch is still a switch, so a request being
  // drafted ahead of the accept decisions can be created unassigned deliberately.
  requestFromAccepted: true,
}

export type CreateFileRequestInput = {
  eventId: RecordId
  title: string
  entityType: TaskEntityType
  instructionsHtml?: string
  required: boolean
  dueAt?: string
  /** Fan it out to the accepted speakers as part of the same save. */
  assign: boolean
}

/**
 * What enables `Create File Request`.
 *
 * The title, and only the title. Ref 31 puts the red asterisk on `Type` and not on `Title`,
 * yet captures the create button dimmed over an empty form whose Type is already selected,
 * so the title is what the gate is waiting for. An untitled request would render in the
 * portal as a blank thing to upload against.
 */
export function isRequestDraftValid(draft: RequestDraft): boolean {
  const title = draft.title.trim()
  return title.length > 0 && title.length <= REQUEST_TITLE_MAX
}

export function toCreateRequestInput(
  eventId: RecordId,
  draft: RequestDraft,
): CreateFileRequestInput {
  return {
    eventId,
    title: draft.title.trim(),
    instructionsHtml: optionalText(draft.instructionsHtml),
    entityType: draft.entityType,
    required: draft.required,
    // Passed through as typed, the way the Add Task drawer passes its due date: reading a
    // zone into it here would guess one, and the zone that matters is the event's.
    dueAt: optionalText(draft.dueAt),
    assign: draft.requestFromAccepted,
  }
}

/**
 * What the save toast says about who the request reached.
 *
 * Said out loud on every branch, including the one where it reached nobody, because that is
 * the outcome the screen cannot show: a request assigned to nobody looks exactly like a
 * request nobody has answered. `undefined` means the switch was off.
 */
export function assignSummary(outcome: { created: number; speakers: number } | undefined): string {
  if (outcome === undefined) return 'Created without requesting it from anybody yet.'
  if (outcome.created === 0) {
    return outcome.speakers === 0
      ? 'No speakers are accepted yet, so nobody has been asked for it.'
      : 'Everybody accepted already had a row for it.'
  }
  const files = `${String(outcome.created)} ${outcome.created === 1 ? 'file' : 'files'}`
  const people = `${String(outcome.speakers)} ${outcome.speakers === 1 ? 'speaker' : 'speakers'}`
  return `Requested ${files} from ${people}.`
}

/**
 * Re-exported under their original names, not defined here any more.
 *
 * They moved to `@/utils/date-key` when the same Sheet-dismissing native date input turned
 * up in the Add Task drawer and the agenda's Edit time and room panel: all three now share
 * `DateKeyField`, and a component in `components/primitives` must not import from a feature.
 * The names stay because a file request's deadline is what they were written for and the
 * tests address them this way.
 */
export { dateKeyOf as dueDateKey, dateKeyValue as dueDateValue } from '@/utils/date-key'

/**
 * An empty rich text editor is not an empty string.
 *
 * TipTap serialises an untouched document as `<p></p>`, so a drawer nobody typed in would
 * otherwise store markup and every card would show a blank snippet where it should show
 * none. Stripping tags to decide emptiness, then storing the ORIGINAL html when there is
 * content, so formatting survives.
 */
function optionalText(raw: string): string | undefined {
  const withoutTags = raw
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
  return withoutTags.length === 0 ? undefined : raw.trim()
}
