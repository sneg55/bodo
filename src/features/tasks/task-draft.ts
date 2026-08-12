// The Add Task drawer's local state, and the rules for turning it into the action's input.
//
// docs/parity/portal-tasks-forms.md lists the task creation form under "Ambiguities": ref
// 25 shows the `Add Task` menu item but never what it opens, so nothing here is captured
// copy. The shape is taken from its sibling that IS captured, the Add File Request drawer
// on ref 31, because BUILD_SPEC 5.6 says Tasks, Forms and File Requests are three tabs of
// one pattern: a Title input, required `Type` cards (`Contacts` selected by default,
// `Groups` dimmed), an instructions body, and a footer whose create button stays disabled
// until valid. What is task-specific and therefore invented is `Kind`, `Due date`, `Form`
// and `Assign to`. Flagged as a deviation rather than passed off as parity.
//
// Split out of the drawer for the same reason add-abstract-draft.ts is: the drawer is
// markup and this is the part worth reading twice. Tested in tests/tasks-cards.test.ts.

import type { TaskEntityType } from '@/constants/status'
import type { TaskKind } from '@/features/portal/task-completion'
import type { RecordId } from '@/types/domain'

/** Matches the registry's cap on a title column, and the drawer counts against it. */
export const TASK_TITLE_MAX = 255

export type TaskTypeCard = {
  entityType: TaskEntityType
  /** Ref 31's card labels, which are plural and audience-shaped. */
  label: string
  description: string
}

/**
 * **`Groups` IS GONE** (2026-08-10), for the reason given in full on `PORTAL_FORM_TYPE_CARDS`:
 * ref 31 dims it, and carrying a dimmed tile forward offered an entity type that has no table
 * in BUILD_SPEC 3 and is not pending anything. A control with nothing behind it is deleted.
 */
export const TASK_TYPE_CARDS: readonly TaskTypeCard[] = [
  {
    entityType: 'contact',
    label: 'Contacts',
    description: 'One to-do per speaker, in their My Tasks list',
  },
  {
    entityType: 'submission',
    label: 'Submissions',
    description: 'One to-do per accepted session, under that session',
  },
]

/**
 * What completion collects. The vocabulary is BUILD_SPEC 5.6's, the copy is not captured.
 *
 * A list of pairs rather than a `Record<TaskKind, string>` so the picker can iterate it
 * without a computed lookup, which `security/detect-object-injection` flags and the build
 * treats as an error. `confirm` leads because it is the default in `EMPTY_TASK_DRAFT`.
 */
export const TASK_KIND_OPTIONS: readonly { kind: TaskKind; label: string }[] = [
  { kind: 'confirm', label: 'Tick a checkbox' },
  { kind: 'upload', label: 'Upload a file' },
  { kind: 'link', label: 'Visit a link and confirm' },
  { kind: 'form', label: 'Fill in a form' },
]

export type TaskDraft = {
  title: string
  description: string
  entityType: TaskEntityType
  kind: TaskKind
  /** A `kind: 'form'` task's linked Form. Empty for every other kind. */
  formId: string
  /** `datetime-local`, so a local wall-clock string with no zone. */
  dueAt: string
  /**
   * Marks the task `appliesTo: all_accepted`, which is the flag BUILD_SPEC 5.6's
   * accept-time fan-out reads. It does not itself assign anything: assigning is the
   * explicit action, so an organizer can define a task before the decisions are made.
   */
  appliesToAllAccepted: boolean
}

export const EMPTY_TASK_DRAFT: TaskDraft = {
  title: '',
  description: '',
  // Ref 31 preselects Contacts, and it is also the safe default: a contact task needs
  // nothing but a speaker, so it cannot be created in a state that assigns to nothing.
  entityType: 'contact',
  kind: 'confirm',
  formId: '',
  dueAt: '',
  appliesToAllAccepted: true,
}

export type CreateTaskInput = {
  eventId: RecordId
  title: string
  description?: string
  entityType: TaskEntityType
  kind: TaskKind
  formId?: RecordId
  dueAt?: string
  appliesTo?: 'all_accepted'
}

/**
 * What enables `Create Task`.
 *
 * A form-kind task with no form selected is refused rather than created, because the
 * portal control for it renders the linked form's fields and would otherwise render an
 * empty task the speaker cannot complete (`toFieldViews` in task-view.ts returns no
 * fields, and `buildCompletion` then accepts nothing).
 */
export function isTaskDraftValid(draft: TaskDraft): boolean {
  const title = draft.title.trim()
  if (title.length === 0 || title.length > TASK_TITLE_MAX) return false
  if (draft.kind === 'form' && draft.formId.trim().length === 0) return false
  return true
}

export function toCreateTaskInput(eventId: RecordId, draft: TaskDraft): CreateTaskInput {
  return {
    eventId,
    title: draft.title.trim(),
    description: optionalText(draft.description),
    entityType: draft.entityType,
    kind: draft.kind,
    formId: draft.kind === 'form' ? optionalText(draft.formId) : undefined,
    // Passed through as typed, the way the Add Abstract drawer passes Starts At: reading a
    // zone into it here would guess one, and the zone that matters is the event's.
    dueAt: optionalText(draft.dueAt),
    appliesTo: draft.appliesToAllAccepted ? 'all_accepted' : undefined,
  }
}

function optionalText(raw: string): string | undefined {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? undefined : trimmed
}
