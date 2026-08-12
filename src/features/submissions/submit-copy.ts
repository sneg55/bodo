// What a failed public submit says to the person who submitted it.
//
// Split out of actions.ts on the file-size limit. Worth its own file rather than an
// arbitrary cut anyway: an `AppError` message is written for a LOG LINE and can name a
// missing environment variable, a table, or an internal id, so none of them is safe to
// show on a public page. This is the translation layer, and keeping it separate from the
// action makes it obvious that adding an error id without adding copy for it falls back
// to the generic sentence rather than leaking the log line.

import { type ErrorId, ErrorIds } from '@/constants/errorIds'
import { UNPROVEN_SUBMITTER_MESSAGE } from '@/features/auth/submitter-identity'

/**
 * What a speaker is told when the error id is not one of the expected ones.
 *
 * Deliberately says nothing about the cause. An unrecognised failure is by definition one
 * nobody wrote copy for, so any detail in it is detail written for an engineer.
 */
export const GENERIC_FAILURE =
  'Something went wrong while saving this submission. Try again, and contact the organizer if it keeps happening.'

/**
 * Copy for the conditions that are about the endpoint rather than a field.
 *
 * Each one ends with what the speaker can actually do next, because "this form is not
 * accepting submissions" on its own leaves somebody holding a finished proposal with
 * nowhere to put it.
 */
export const FAILURE_COPY: ReadonlyMap<ErrorId, string> = new Map([
  [
    ErrorIds.SUB_FORM_CLOSED,
    'This form has closed and is no longer accepting submissions. Contact the organizer if you think this is a mistake.',
  ],
  [
    ErrorIds.SUB_LIMIT_REACHED,
    'You have reached the submission limit for this form. Withdraw an existing submission from your portal if you want to submit something else.',
  ],
  [
    ErrorIds.SUB_VALIDATION_FAIL,
    'Something in the submission could not be read. Reload the page and try again.',
  ],
  // Shared with the guard that raises it rather than restated here, because the wording is
  // load-bearing: it must not name whose profile the address belongs to, and it has to
  // promise the answers are kept, which is why the wizard holds its draft in localStorage.
  [ErrorIds.SUB_UNVERIFIED_SUBMITTER, UNPROVEN_SUBMITTER_MESSAGE],
])
