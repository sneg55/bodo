// What a named-speaker assignment is about to do, read off the cards an organizer ticked.
// SPK-09.
//
// THE TRAP THIS ANSWERS, and it is the one that made SPK-09 unjudgeable in the first place: a
// SUBMISSION-scoped task assigned to somebody with no accepted session writes NOTHING.
// `planFanout` refuses to invent a row with an empty submission link and it is right to, but
// the organizer presses Assign, gets a success, and the speaker's portal stays empty.
//
// `unreachableScopes` in roster-scope.ts is the server's answer to that, and it is
// authoritative: it runs the real planner per scope. This is the CLIENT's half, and it exists
// for a different reason. The server can only speak after the write. An organizer choosing
// people needs to know before it, and the two together are what stop a control from claiming
// N and delivering fewer.
//
// The board's bulk bar assigns SEVERAL tasks at once, which is the case the Add Task drawer
// never has, and it is where the naive reading goes wrong: a selection of three tasks where
// only one is submission-scoped still silently drops that one for a speaker with no accepted
// session. So the question is not "is this a Submissions task" but "does this selection
// contain one", and `entityTypeForWarning` answers the second.
//
// Pure, and tested in tests/tasks-assign-selection.test.ts.

import type { TaskEntityType } from '@/constants/status'
import type { TaskCardView } from '@/features/tasks/cards'

export type AssignSelection = {
  /** How many of the event's tasks are ticked. */
  readonly tasks: number
  /** How many of those fan out per accepted session rather than per person. */
  readonly submissionScoped: number
}

export function assignSelection(
  cards: readonly TaskCardView[],
  selectedIds: readonly string[],
): AssignSelection {
  const picked = new Set(selectedIds)
  // Resolved against the CARDS rather than counted off the id list, so an id left over from a
  // task that has since been deleted is not counted as a task about to be assigned.
  const chosen = cards.filter((card) => picked.has(card.id))

  return {
    tasks: chosen.length,
    submissionScoped: chosen.filter((card) => card.entityType === 'submission').length,
  }
}

/**
 * The entity type to hand the speaker picker, so its per-row warning fires correctly.
 *
 * `submission` when ANY ticked task is submission-scoped, and that is the conservative
 * direction on purpose. The picker greys nothing and blocks nothing; it warns that the people
 * with no accepted session will not be reached. For a mixed selection that warning is TRUE of
 * at least one of the tasks, and staying quiet because the other two would land is how the
 * silent-drop bug comes back.
 *
 * `contact` otherwise, which is the value that makes the picker's warning stand down. Group
 * and contact tasks both fan out one row per person regardless of sessions, so neither can
 * produce the empty write this is guarding against.
 */
export function entityTypeForWarning(selection: AssignSelection): TaskEntityType {
  return selection.submissionScoped > 0 ? 'submission' : 'contact'
}

/**
 * The line above the picker: what is being assigned, and which half of it is conditional.
 *
 * Factual rather than a second warning. The picker already says "these people will not be
 * reached"; what it cannot know is how much of the selection that applies to, because it is
 * handed one entity type and not the cards. Supplying that here is what makes its sentence
 * precise instead of leaving an organizer to guess whether all three tasks are affected.
 */
export function assignSelectionSummary(selection: AssignSelection): string {
  const tasks = `${String(selection.tasks)} ${selection.tasks === 1 ? 'task' : 'tasks'}`

  if (selection.submissionScoped === 0) {
    return `Assigning ${tasks}. Every chosen speaker gets a row.`
  }
  if (selection.submissionScoped === selection.tasks) {
    return `Assigning ${tasks}, all Submissions-scoped: they reach a speaker once per accepted session, so a speaker with none gets nothing.`
  }
  return `Assigning ${tasks}, of which ${String(selection.submissionScoped)} ${selection.submissionScoped === 1 ? 'is' : 'are'} Submissions-scoped: ${selection.submissionScoped === 1 ? 'that one reaches' : 'those reach'} a speaker once per accepted session, so a speaker with none gets nothing from ${selection.submissionScoped === 1 ? 'it' : 'them'}.`
}
