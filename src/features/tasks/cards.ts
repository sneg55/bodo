// The admin Tasks list, flattened for the client.
//
// Ref 25 in docs/parity/portal-tasks-forms.md is one card per task: title, a `Manual`
// chip, a description snippet, and a type icon with the label `Contact` or `Session`. The
// tab strip above it counts by type, `All Tasks 3 / Contact Tasks 1 / Group Tasks 0 /
// Submission Tasks 2`, and that screenshot settles what "Submission Tasks" counts: the two
// tasks whose metadata row reads `Session` are the two under that tab, so the label is
// `Session` on the card and `Submission Tasks` on the tab for one and the same type.
//
// Flattened rather than sending `Task` across the boundary, for the reason task-view.ts
// gives on the portal side: the list is interactive (search, tabs, an Assign action) so it
// is a client component, and BUILD_SPEC 6.3 scores payload discipline.
//
// Pure, and tested in tests/tasks-cards.test.ts.

import type { TaskEntityType } from '@/constants/status'
import { dedupeAssignments } from '@/features/portal/task-groups'
import { formatDue, isManualTask } from '@/features/portal/task-view'
import type { TaskAssignmentItem } from '@/services/airtable/reads-portal'
import type { RecordId, Task } from '@/types/domain'
import type { Form } from '@/types/forms'

export type TaskTab = 'all' | 'contact' | 'group' | 'submission'

/** Tab id, label and predicate together, so nothing looks a label up by a computed key. */
const TABS: readonly { id: TaskTab; label: string; keep: (card: TaskCardView) => boolean }[] = [
  { id: 'all', label: 'All Tasks', keep: () => true },
  { id: 'contact', label: 'Contact Tasks', keep: (card) => card.entityType === 'contact' },
  { id: 'group', label: 'Group Tasks', keep: (card) => card.entityType === 'group' },
  { id: 'submission', label: 'Submission Tasks', keep: (card) => card.entityType === 'submission' },
]

export type TaskTabView = { id: TaskTab; label: string; count: number }

/** The metadata-row label on the card. `Session`, not `Submission`, per ref 25. */
export const TASK_TYPE_LABELS: Record<TaskEntityType, string> = {
  contact: 'Contact',
  group: 'Group',
  submission: 'Session',
}

export type TaskCardView = {
  id: RecordId
  title: string
  /** The snippet ref 25 shows under the title. Absent when the task has none. */
  description?: string
  entityType: TaskEntityType
  typeLabel: string
  kind: Task['kind']
  /**
   * Ref 25 renders a manual task as a `Manual` chip.
   *
   * Not `origin === 'manual'`, which is what it used to be: a form-backed task renders its
   * questions inline and is manual on neither side, so `isManualTask` decides it once for
   * this card and the speaker's list together. The linked form's name is the chip that
   * belongs on such a task here, and `formName` below already carries it.
   */
  manual: boolean
  dueLabel?: string
  /** The linked form's name, for a `kind: 'form'` task. */
  formName?: string
  /** How far the fan-out has got: distinct assignments, and how many are done. */
  assigned: number
  done: number
}

export function toTaskCards(input: {
  tasks: readonly Task[]
  items: readonly TaskAssignmentItem[]
  forms: readonly Form[]
  /** The event's timezone, so a due date reads the same here and in the portal. */
  timeZone: string
}): readonly TaskCardView[] {
  const formById = new Map(input.forms.map((form) => [form.id, form]))
  const counts = countByTask(input.items)

  return input.tasks.map((task) => {
    const tally = counts.get(task.id)
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      entityType: task.entityType,
      typeLabel: TASK_TYPE_LABELS[task.entityType],
      kind: task.kind,
      manual: isManualTask(task),
      dueLabel: formatDue(task.dueAt, input.timeZone),
      formName: task.formId === undefined ? undefined : formById.get(task.formId)?.name,
      assigned: tally?.assigned ?? 0,
      done: tally?.done ?? 0,
    }
  })
}

/**
 * Assignments per task, through the SHARED dedup so the card, the progress table and the
 * speaker's own list cannot disagree about how many to-dos one task created.
 *
 * This used to keep whichever duplicate Airtable returned first, which meant the card could
 * read `0/1` or `1/1` for the same data depending on row order. See `dedupeAssignments`.
 */
function countByTask(
  items: readonly TaskAssignmentItem[],
): ReadonlyMap<RecordId, { assigned: number; done: number }> {
  const counts = new Map<RecordId, { assigned: number; done: number }>()

  for (const item of dedupeAssignments(items)) {
    const tally = counts.get(item.task.id) ?? { assigned: 0, done: 0 }
    tally.assigned += 1
    if (item.assignment.status === 'done') tally.done += 1
    counts.set(item.task.id, tally)
  }

  return counts
}

/** The tab strip with its live counts, e.g. `All Tasks 3`, `Contact Tasks 1`. */
export function taskTabs(cards: readonly TaskCardView[]): readonly TaskTabView[] {
  return TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    count: cards.filter(tab.keep).length,
  }))
}

/** The `Search tasks...` box and the tab strip, applied together. */
export function filterTaskCards(
  cards: readonly TaskCardView[],
  tab: TaskTab,
  search: string,
): readonly TaskCardView[] {
  const keep = TABS.find((candidate) => candidate.id === tab)?.keep ?? (() => true)
  const needle = search.trim().toLowerCase()

  return cards.filter((card) => {
    if (!keep(card)) return false
    if (needle.length === 0) return true
    // Title and description both, because ref 25 shows the description snippet on the
    // card, so it is text the organizer can see and would expect to search.
    return `${card.title} ${card.description ?? ''}`.toLowerCase().includes(needle)
  })
}
