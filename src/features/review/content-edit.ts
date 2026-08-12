// The organizer's own edit of a submission's title and abstract.
//
// Deliberately NOT `features/portal/submission-edit.ts`, and the difference is the point.
// That path is the SPEAKER editing their own submission, so it is gated on
// `bodyEditPermission`: open while the form accepts updates, locked once a decision has
// been made. An organizer is not subject to that lock. A programme chair fixing a typo in
// an accepted talk's title the week before the event is the ordinary case, and refusing it
// because the CFP closed would be the tool arguing with the person who owns the data.
//
// So this is a narrower write with a wider permission: two fields, admin only, no close
// date, no status gate. Everything else about the submission (format, track, tags,
// participants) keeps its existing route, because widening this into a general editor is
// how the two paths would start disagreeing about validation.
//
// Pure. The action resolves the records and performs the write; this decides what the
// write should be and what changed, and the second half is not a nicety: the change list
// is what the revision history is built from, so "what did the organizer actually alter"
// has to be computed once, here, rather than inferred later from two versions of a row.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { registryField } from '@/constants/fields'
import { MANUAL_DESCRIPTION_KEY } from '@/features/review/abstract-text'
import type { SubmissionEdit } from '@/services/airtable/to-fields'
import type { SubmissionWithParticipants } from '@/types/domain'
import type { Form, FormField } from '@/types/forms'

/** The registry key of the field the product calls the abstract. */
const ABSTRACT_KEY = MANUAL_DESCRIPTION_KEY

export const TITLE_MAX_LENGTH = 255

export type ContentChange = {
  field: 'Title' | 'Abstract'
  from: string
  to: string
}

/** The two fields this editor writes, which is also the vocabulary the history uses. */
export const CONTENT_FIELD_LABELS: readonly ContentChange['field'][] = ['Title', 'Abstract']

export type ContentEditResult = {
  edit: SubmissionEdit
  /** Empty when the organizer pressed Save without altering anything. */
  changes: readonly ContentChange[]
}

/**
 * Which of the form's questions holds the abstract.
 *
 * By `registryKey`, never by label or by type, for the reason `answer-storage.ts` gives
 * at length: a local question an organizer happened to name "Description" is structurally
 * identical to the registry's, and guessing would let this write one question's answer
 * into another's storage.
 *
 * The registry marks `description` as `column: false`, so the answer lives in
 * `answersJson` under the FIELD's id rather than in a first-class column.
 *
 * `undefined` here means "no form field", NOT "no abstract": see `abstractAnswerKey`.
 */
export function abstractField(form: Form | undefined): FormField | undefined {
  if (form === undefined) return undefined
  return form.fields.find((field) => field.registryKey === ABSTRACT_KEY)
}

/**
 * The `answersJson` key the abstract lives under.
 *
 * The form field's id where the submission came through a form that asks for one, and the
 * registry key itself otherwise. That second half is a fix rather than a tidy-up: this
 * editor used to treat a missing form field as "there is nowhere to put an abstract" and
 * rendered a Title box on its own, so on the seed's hand-entered keynote the abstract
 * could not be edited at all. There always was somewhere to put it. `manual-abstract.ts`
 * writes the body typed into Add Abstract under this exact key, and `submissionDescription`
 * already falls back to reading it, so the three now agree by construction.
 */
export function abstractAnswerKey(field: FormField | undefined): string {
  return field?.id ?? ABSTRACT_KEY
}

/** What the record currently holds for the abstract, or `''` when it holds nothing. */
export function storedAbstract(
  submission: SubmissionWithParticipants,
  field: FormField | undefined,
): string {
  const value = submission.answers[abstractAnswerKey(field)]
  return typeof value === 'string' ? value : ''
}

export function prepareContentEdit(input: {
  submission: SubmissionWithParticipants
  form?: Form
  title: string
  /** Stored under the manual key when the form asks no abstract; see `abstractAnswerKey`. */
  abstract: string
}): ContentEditResult {
  const title = input.title.trim()
  if (title === '') {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'a session needs a title', {
      submissionId: input.submission.id,
    })
  }
  if (title.length > TITLE_MAX_LENGTH) {
    throw new AppError(
      ErrorIds.SUB_VALIDATION_FAIL,
      `title is capped at ${String(TITLE_MAX_LENGTH)} characters`,
      { submissionId: input.submission.id, length: title.length },
    )
  }

  const field = abstractField(input.form)
  const previousAbstract = storedAbstract(input.submission, field)
  const abstract = input.abstract.trim()

  const changes: ContentChange[] = []
  if (title !== input.submission.title) {
    changes.push({ field: 'Title', from: input.submission.title, to: title })
  }
  if (abstract !== previousAbstract) {
    changes.push({ field: 'Abstract', from: previousAbstract, to: abstract })
  }

  return {
    edit: {
      title,
      // The WHOLE blob, because `submissionEditFields` replaces `answersJson` rather than
      // merging into it (a merge would make a cleared question impossible to clear). So
      // every other answer has to be carried through here, and an edit that passed only
      // the abstract would silently delete the rest of the submission.
      answers: { ...input.submission.answers, [abstractAnswerKey(field)]: abstract },
    },
    changes,
  }
}

/** Whether the registry still declares the abstract, so a rename there fails loudly. */
export function abstractRegistryLabel(): string {
  return registryField(ABSTRACT_KEY)?.label ?? 'Abstract'
}

/** What a restore needs off a history row, so this stays free of the DAL's types. */
export type RestorableRevision = {
  fieldLabel: string
  previousValue: string
}

/**
 * The title and abstract a restore should SAVE, given the entry being put back.
 *
 * Deliberately expressed as a whole content edit rather than a patch of one column, and
 * that is what makes restore an ordinary save: the values go back through
 * `prepareContentEdit`, so a restored title is trimmed and length-checked like any other,
 * the other field is carried through untouched, and the write leaves a NEW history row
 * saying what was put back and by whom. Rewriting history in place, or deleting the rows
 * after the restored one, would make the panel answer a different question from the one
 * an audit trail is asked.
 *
 * The entry names its field by the label the history shows, which is the same vocabulary
 * `ContentChange` uses. An unknown label is refused rather than guessed: a row typed
 * straight into the Airtable grid can carry anything, and restoring "Titel" onto the
 * title would put a stranger's text into the record.
 */
export function restorePayload(input: {
  revision: RestorableRevision
  currentTitle: string
  currentAbstract: string
}): { title: string; abstract: string; field: ContentChange['field'] } {
  const field = CONTENT_FIELD_LABELS.find((known) => known === input.revision.fieldLabel)
  if (field === undefined) {
    throw new AppError(
      ErrorIds.SUB_VALIDATION_FAIL,
      `"${input.revision.fieldLabel}" is not a field this editor can restore`,
      { allowed: [...CONTENT_FIELD_LABELS] },
    )
  }

  return {
    field,
    title: field === 'Title' ? input.revision.previousValue : input.currentTitle,
    abstract: field === 'Abstract' ? input.revision.previousValue : input.currentAbstract,
  }
}

/**
 * A revision's timestamp as the history shows it.
 *
 * UTC, and not the event's timezone, for the reason the detail panel gives beside its own
 * copy of this: the history says when somebody typed, which is not an event-local fact.
 * Here so the restore dialog and its tests read the same clock without either importing a
 * server component.
 */
export function formatRevisionStamp(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(parsed)
}
