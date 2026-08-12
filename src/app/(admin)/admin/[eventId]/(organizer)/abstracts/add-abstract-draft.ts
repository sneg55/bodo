// The Add Abstract drawer's local form state, and the rules for turning it into the
// action's input. Split out of the drawer so the drawer is markup and this is the part
// worth reading twice.

import type { SubmissionStatus } from '@/constants/status'
import type {
  ManualAbstractInput,
  ManualParticipantInput,
} from '@/features/submissions/manual-abstract'

/** The registry caps Title at 255, and the drawer shows a 0/255 counter against it. */
export const TITLE_MAX = 255

/**
 * The statuses a manually entered abstract may start in.
 *
 * Not the whole vocabulary on purpose. The two queue states are what Notify commits, so
 * creating a row directly in one would stage a decision nobody made; Declined and
 * Withdrawn describe things that happened to a submission that existed first.
 */
export const START_STATUSES: readonly SubmissionStatus[] = ['pending', 'draft', 'accepted']

export type AbstractDraft = {
  title: string
  status: SubmissionStatus
  description: string
  startsAt: string
  endsAt: string
  capacity: string
  ceuCredits: string
  clientSessionId: string
  format: string
  email: string
  firstName: string
  lastName: string
}

/**
 * A participant after the first.
 *
 * The primary speaker's three fields stay on `AbstractDraft` above, because those are what
 * `missingFromAbstractDraft` gates Create Abstract on and what `Submissions.submitter`
 * requires. These are held beside the draft and appended in the order they were added.
 *
 * Keyed, not indexed: removing the second of three rows would otherwise hand the third row
 * the second one's React key and, with it, the second one's input state.
 */
export type ExtraParticipant = {
  key: string
  email: string
  firstName: string
  lastName: string
}

/** The three editable fields of an extra row, which is what `setExtraField` may write. */
export type ExtraParticipantField = 'email' | 'firstName' | 'lastName'

export function blankExtraParticipant(): ExtraParticipant {
  return { key: crypto.randomUUID(), email: '', firstName: '', lastName: '' }
}

export function setExtraField(
  extras: readonly ExtraParticipant[],
  key: string,
  field: ExtraParticipantField,
  value: string,
): readonly ExtraParticipant[] {
  return extras.map((entry) => (entry.key === key ? { ...entry, [field]: value } : entry))
}

export function removeExtraParticipant(
  extras: readonly ExtraParticipant[],
  key: string,
): readonly ExtraParticipant[] {
  return extras.filter((entry) => entry.key !== key)
}

export const EMPTY_ABSTRACT_DRAFT: AbstractDraft = {
  title: '',
  status: 'pending',
  description: '',
  startsAt: '',
  endsAt: '',
  capacity: '',
  ceuCredits: '',
  clientSessionId: '',
  format: '',
  email: '',
  firstName: '',
  lastName: '',
}

function optionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim()
  const parsed = Number(trimmed)
  return trimmed.length > 0 && Number.isFinite(parsed) ? parsed : undefined
}

function optionalText(raw: string): string | undefined {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/**
 * What enables Create Abstract.
 *
 * Title is the only field the audit marks required. The participant email is bodo's own
 * constraint rather than a parity item: `Submissions.submitter` is a required link and it
 * is who Notify emails, so an abstract with nobody on it could never be accepted. The
 * Participants tab says so in words rather than failing on submit.
 */
export function isAbstractDraftValid(
  draft: AbstractDraft,
  extras: readonly ExtraParticipant[] = [],
): boolean {
  return missingFromAbstractDraft(draft, extras).length === 0
}

/**
 * What is still stopping Create Abstract, in words, so the drawer can say so.
 *
 * The disabled button on its own was the worst kind of dead end, because the two required
 * fields live on DIFFERENT tabs: Title is on Details with its asterisk in plain sight, and
 * the participant email is on Participants. Filling in the visible required field and
 * finding the button still inert, with nothing anywhere naming the reason, reads as a
 * broken button rather than an incomplete form. It was reported as exactly that.
 *
 * Each entry names its tab, because "Email is required" is not actionable when the field
 * is not on screen. The shape mirrors the public CFP wizard's "N things need attention",
 * which is the pattern this product already uses for the same problem.
 */
export function missingFromAbstractDraft(
  draft: AbstractDraft,
  extras: readonly ExtraParticipant[] = [],
): readonly string[] {
  const missing: string[] = []
  const title = draft.title.trim()

  if (title.length === 0) missing.push('Details: Title is required.')
  else if (title.length > TITLE_MAX)
    missing.push(`Details: Title must be ${TITLE_MAX} characters or fewer.`)

  if (draft.email.trim().length === 0) {
    missing.push('Participants: Email is required for the primary speaker.')
  }

  // Every participant is upserted BY EMAIL (`upsertSpeakerByEmail`), so a row with none
  // would attach a nameless speaker rather than refuse. One entry however many rows are
  // blank: the list names what to do, and it is the same thing in each case.
  //
  // An UNTOUCHED panel does not count. `+ ADD PARTICIPANT` inserts an empty one, and
  // treating that as a validation failure meant the control blocked the form the moment it
  // was pressed: the organizer got "Email is required for every participant" for a panel
  // they had typed nothing into, and the only way forward was to find the small close icon.
  // Pressing a button to add somebody, and then being refused for not having added them
  // yet, is the control arguing with itself. A panel with ANY of the three fields filled in
  // is a real attempt and is still checked.
  if (extras.some((entry) => !isBlankExtra(entry) && entry.email.trim().length === 0)) {
    missing.push('Participants: Email is required for every participant.')
  }

  return missing
}

/**
 * A panel the organizer has not typed anything into.
 *
 * All three fields, not just the email: a row with a name and no address is somebody
 * half-entered, and that one still has to be completed or removed.
 */
export function isBlankExtra(entry: ExtraParticipant): boolean {
  return (
    entry.email.trim().length === 0 &&
    entry.firstName.trim().length === 0 &&
    entry.lastName.trim().length === 0
  )
}

export function toManualAbstractInput(
  eventId: string,
  draft: AbstractDraft,
  extras: readonly ExtraParticipant[] = [],
): ManualAbstractInput {
  return {
    eventId,
    title: draft.title,
    status: draft.status,
    description: draft.description,
    capacity: optionalNumber(draft.capacity),
    ceuCredits: optionalNumber(draft.ceuCredits),
    clientSessionId: optionalText(draft.clientSessionId),
    format: optionalText(draft.format),
    // An ISO INSTANT, already resolved in the event's zone by `DateTimeField`, which is
    // the control the drawer uses now. It used to be the raw `datetime-local` wall clock,
    // passed through with no zone at all and read as UTC wherever it landed.
    startsAt: optionalText(draft.startsAt),
    endsAt: optionalText(draft.endsAt),
    // The primary speaker first: `manual-abstract.ts` writes `participants.at(0)` as
    // `Submissions.submitter`, which is who Notify emails.
    participants: [
      {
        email: draft.email,
        firstName: draft.firstName,
        lastName: draft.lastName,
        role: 'speaker',
      },
      // Untouched panels are DROPPED rather than sent. `missingFromAbstractDraft` stopped
      // refusing them above, so without this an empty one would reach
      // `upsertSpeakerByEmail` and create a nameless speaker with an empty address.
      ...extras
        .filter((entry) => !isBlankExtra(entry))
        .map(
          (entry): ManualParticipantInput => ({
            email: entry.email,
            firstName: entry.firstName,
            lastName: entry.lastName,
            role: 'speaker',
          }),
        ),
    ],
  }
}
