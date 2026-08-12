// What a speaker may change on their own submission, and why.
//
// BUILD_SPEC 5.2 makes this three explicit modes rather than a scatter of disabled
// attributes, and it makes the page say which one it is in. The reason is stated
// there and it is a data-integrity one, not a UX one: a speaker who silently
// rewrites an abstract after acceptance changes what the organizer agreed to
// schedule, and no admin screen would ever show that it happened. A disabled input
// tells nobody why.
//
// Pure and unit tested, because the interesting cases are combinations (a draft on a
// form that has since closed, a pending submission on a closed form, a decided
// submission on a form that is still open) and each of them is one line to assert
// and a long trip through the UI to reproduce.

import { SPEAKER_EDITABLE_STATUSES, type SubmissionStatus } from '@/constants/status'

/**
 * The three modes, named after what the speaker can do rather than after the status
 * that produced them, because two different statuses can land in the same mode.
 */
export type SubmissionEditMode =
  /** Draft on an open form: the whole submission is still theirs to change. */
  | 'full'
  /** Submitted, and the form still accepts updates: the body may still be edited. */
  | 'body_updates'
  /** Decided or closed: the body is frozen, profile and tasks are not. */
  | 'body_locked'

export type EditPermission = {
  mode: SubmissionEditMode
  /** Title and answers. False means render them read-only, not merely disabled. */
  bodyEditable: boolean
  /**
   * True when a save has to notify the form's `adminAlertOnUpdate` recipients
   * (BUILD_SPEC 5.3). Only an edit AFTER submission is an update an organizer needs
   * to hear about; a draft that has never been submitted is not news.
   */
  alertsAdminsOnSave: boolean
  /** Short heading for the mode banner. */
  title: string
  /** The sentence the detail page shows. Authored: this surface is uncaptured. */
  detail: string
}

export type EditPermissionInput = {
  status: SubmissionStatus
  /**
   * Whether the form this submission came through still accepts submissions and
   * updates. Derived by the caller from `formPublicState` (@/types/forms), so a
   * manual submission with no form can pass `false` and get the frozen mode, which
   * is the right answer: there is no form left to edit it through.
   */
  formAcceptsUpdates: boolean
}

const DECIDED: readonly SubmissionStatus[] = ['accepted', 'declined']

export function submissionEditPermission(input: EditPermissionInput): EditPermission {
  const { status, formAcceptsUpdates } = input

  // Checked before the form's state, because a decision outranks it. An organizer
  // reopening a form must not reopen an accepted abstract along with it.
  if (DECIDED.includes(status)) {
    return {
      mode: 'body_locked',
      bodyEditable: false,
      alertsAdminsOnSave: false,
      title: 'This submission is read-only',
      detail:
        'A decision has been recorded, so the submission content can no longer be changed here. Your profile and your tasks are still editable. Contact the organizer if something in the session details has to change.',
    }
  }

  if (!SPEAKER_EDITABLE_STATUSES.includes(status)) {
    return {
      mode: 'body_locked',
      bodyEditable: false,
      alertsAdminsOnSave: false,
      title: 'This submission is read-only',
      detail:
        'This submission is no longer open for speaker edits. Your profile and your tasks are still editable.',
    }
  }

  if (!formAcceptsUpdates) {
    return {
      mode: 'body_locked',
      bodyEditable: false,
      alertsAdminsOnSave: false,
      title: 'This submission is read-only',
      detail:
        'The form this was submitted through has closed, so the submission content can no longer be changed. Your profile and your tasks are still editable.',
    }
  }

  if (status === 'draft') {
    return {
      mode: 'full',
      bodyEditable: true,
      alertsAdminsOnSave: false,
      title: 'This submission is a draft',
      detail:
        'Nothing has been submitted yet, so everything here is still editable. Submit it before the form closes to put it in front of the organizer.',
    }
  }

  return {
    mode: 'body_updates',
    bodyEditable: true,
    alertsAdminsOnSave: true,
    title: 'This submission can still be updated',
    detail:
      'It has been submitted and the form is still accepting updates, so you can revise the content. The organizer is notified of every change you save.',
  }
}
