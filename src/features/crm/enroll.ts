// What enrolling a contact into a pipeline stage records, beyond the move itself.
//
// Pure and synchronous, with no `'use server'` directive, for the reason `notes.ts` gives: a
// `'use server'` file may only export async functions, and this composes a string. The action
// is `enroll-actions.ts` and the control is `EnrollContactButton.tsx`; both call this, so the
// note the dialog previews is the note that gets written.
//
// THE SCORE IS PART OF THE NOTE, NOT A COLUMN, and that is deliberate rather than a shortcut.
// A fit score is a judgement one organizer made on one day, next to the reason they made it,
// which is exactly what `SpeakerNotes` already is: append-only, attributed, and stamped. A new
// single-select on Speakers would be a second, unattributed number that nothing could explain
// and that would silently overwrite the last person's opinion. Both fields are optional; the
// eval criteria calls them bonus, and enrolling with neither writes no note at all.

import { type SpeakerStatus, speakerStatusLabel } from '@/constants/status'

/** The scores the dialog offers. Five points, because three is not enough to rank on. */
export const ENROLL_SCORES: readonly number[] = [1, 2, 3, 4, 5]

/** The value the score `Select` carries when the organizer has not scored the contact. */
export const NO_SCORE = 'none'

/** How long a rationale may be. The note cap, because that is what it becomes. */
export const RATIONALE_MAX = 1_000

export type EnrollmentDetail = {
  readonly stage: SpeakerStatus
  /** 1 to 5, or absent. Anything else is dropped rather than written; see `enrollmentNote`. */
  readonly score?: number
  readonly rationale?: string
}

/**
 * The note an enrollment leaves behind, or `undefined` when it leaves none.
 *
 * `undefined` and not the empty string, and the difference matters at the call site: an empty
 * note would be refused by `checkNoteBody` and turn a successful enrollment into an error
 * about a field the organizer deliberately left blank. Enrolling with no score and no
 * rationale is the ordinary case and writes only the stage move, which the stage history
 * records on its own.
 *
 * The stage is named in the note as well as being written to the column, because a note is
 * read months later in a list of other notes and "Enrolled" on its own does not say into
 * what. `speakerStatusLabel` is the same vocabulary the column headings use.
 *
 * A score outside 1 to 5 is DROPPED rather than refused: it can only arrive from a hand-built
 * POST, the rationale beside it is still worth keeping, and refusing the whole enrollment over
 * a number the dialog cannot produce would be a worse trade than losing the number.
 */
export function enrollmentNote(detail: EnrollmentDetail): string | undefined {
  const rationale = (detail.rationale ?? '').trim().slice(0, RATIONALE_MAX)
  const scored =
    detail.score !== undefined && ENROLL_SCORES.includes(detail.score) ? detail.score : undefined
  if (rationale === '' && scored === undefined) return undefined

  const parts = [`Enrolled in ${speakerStatusLabel(detail.stage)}.`]
  if (scored !== undefined) parts.push(`Fit score ${String(scored)}/5.`)
  if (rationale !== '') parts.push(rationale)
  return parts.join(' ')
}
