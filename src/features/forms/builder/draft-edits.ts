// Every question-list edit, as a function of the draft it is applied to.
//
// This exists because of a data-loss bug, not for tidiness. The editor held one piece of
// state, the whole draft, and each step computed its next value from the copy it had been
// rendered with: `setFields(addField(fields, field))`, where `fields` came from a closure.
// Two edits derived from the SAME copy do not merge, they overwrite, and the second one
// silently takes the first one's questions away with it. React only makes that safe when
// every edit has been committed and re-rendered in between, which is a property of timing
// rather than of the code: an organizer (or a browser agent) who adds a question and clicks
// Save inside one task gets both handlers run against one render, and the save then stores a
// field list that is missing the question still visible on screen. That is the
// "an intervening save silently dropped the newly added fields" half of the CFP-01 finding.
//
// So nothing here takes a field list. Every function takes the CURRENT draft and returns the
// patch to merge into it, and `FormEditor` applies them through the updater form of
// `setState`, where "current" is guaranteed to be current. `applyPatch` is the one place the
// merge happens, so a test can walk the same sequence the UI does.

import type { FormDraft } from '@/features/forms/builder/draft'
import {
  addField,
  moveField,
  pruneRouting,
  removeField,
  reorderFields,
  updateField,
} from '@/features/forms/builder/field-ops'
import type { FormField } from '@/types/forms'

/** Which of the two question lists an edit applies to: step 3's or step 4's. */
export type QuestionKind = 'abstract' | 'participant'

/** A patch, or a function of the current draft that produces one. */
export type DraftPatch = Partial<FormDraft> | ((current: FormDraft) => Partial<FormDraft>)

/** The one merge. Kept here rather than inline in the component so tests can drive it. */
export function applyPatch(draft: FormDraft, patch: DraftPatch): FormDraft {
  return { ...draft, ...(typeof patch === 'function' ? patch(draft) : patch) }
}

export function questionsOf(draft: FormDraft, kind: QuestionKind): readonly FormField[] {
  return kind === 'participant' ? draft.participantFields : draft.fields
}

function withQuestions(kind: QuestionKind, next: readonly FormField[]): Partial<FormDraft> {
  return kind === 'participant' ? { participantFields: next } : { fields: next }
}

export function addQuestion(
  draft: FormDraft,
  kind: QuestionKind,
  field: FormField,
): Partial<FormDraft> {
  return withQuestions(kind, addField(questionsOf(draft, kind), field))
}

/**
 * Deleting a question takes the routing rules that fire on it, since routing lives on the
 * abstract questions. `normalizeFields` would drop them on save anyway; doing it here means
 * the routing card stops showing a rule the organizer can no longer edit.
 */
export function removeQuestion(
  draft: FormDraft,
  kind: QuestionKind,
  id: string,
): Partial<FormDraft> {
  const questions = withQuestions(kind, removeField(questionsOf(draft, kind), id))
  if (kind === 'participant') return questions
  return { ...questions, routing: pruneRouting(draft.routing, id) }
}

export function patchQuestion(
  draft: FormDraft,
  kind: QuestionKind,
  id: string,
  patch: Partial<FormField>,
): Partial<FormDraft> {
  return withQuestions(kind, updateField(questionsOf(draft, kind), id, patch))
}

export function moveQuestion(
  draft: FormDraft,
  kind: QuestionKind,
  id: string,
  delta: number,
): Partial<FormDraft> {
  return withQuestions(kind, moveField(questionsOf(draft, kind), id, delta))
}

export function reorderQuestions(
  draft: FormDraft,
  kind: QuestionKind,
  activeId: string,
  overId: string,
): Partial<FormDraft> {
  return withQuestions(kind, reorderFields(questionsOf(draft, kind), activeId, overId))
}
