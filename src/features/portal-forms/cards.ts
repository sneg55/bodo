// The admin Portals > Forms list, flattened for the client.
//
// A portal form is NOT a second kind of record. `FORM_KINDS = ['cfp', 'task']` in
// src/migrations/tables-core.ts, so a portal form is a `Forms` row with `kind: 'task'` and
// the COLLECT & REVIEW list is the same table filtered the other way (`loadFormsList` keeps
// `kind === 'cfp'`). That filter is the entire difference between the two surfaces, which is
// why it lives here as one exported predicate instead of being written inline at each read:
// a list that forgot it would open a call for papers in the portal editor, and a portal
// editor that saved one would wipe its routing rules and its participant step.
//
// Ref 26 in docs/parity/portal-tasks-forms.md captured this list EMPTY, so the tab strip and
// the empty state are transcribed verbatim (`All Forms 0 / Contact Forms 0 / Group Forms 0 /
// Submission Forms 0`, then `No forms yet` over `Create a form to collect information from
// participants`) and the card is not captured. The card is therefore borrowed from its
// captured siblings, the task card on ref 25 and the file request card, exactly as
// `@/features/file-requests/cards` borrowed it: BUILD_SPEC 5.6 calls the three "three tabs of
// one pattern", so a third card design would be a bigger invention than reusing theirs.
//
// The type label on a card is `Session` while its tab reads `Submission Forms`, for one and
// the same `entityType`. That is ref 25's own inconsistency, and `TASK_TYPE_LABELS` is reused
// rather than copied.
//
// Pure, and tested in tests/portal-forms-cards.test.ts.

import type { TaskEntityType } from '@/constants/status'
import { TASK_TYPE_LABELS } from '@/features/tasks/cards'
import type { RecordId, Task, TaskAssignment } from '@/types/domain'
import type { Form } from '@/types/forms'

/** Copy for a portal form whose `entityType` column is blank. See `PortalFormCardView`. */
export const NO_TYPE_LABEL = 'Type not set'

/**
 * The portal forms out of an event's whole form list.
 *
 * The one predicate both portal reads go through. `kind` is assigned at creation and never
 * edited (`FormContent` omits it), so this is a stable partition rather than a filter over
 * mutable state.
 */
export function portalForms(forms: readonly Form[]): readonly Form[] {
  return forms.filter((form) => form.kind === 'task')
}

/**
 * One portal form by id, or undefined when the id names a CFP form, another event's form, or
 * nothing at all.
 *
 * All three answer the same way on purpose. The editor 404s on undefined, and telling an
 * organizer that the id they typed is a call for papers rather than a portal form would
 * invite them to go and open it in the wrong editor.
 */
export function findPortalForm(forms: readonly Form[], formId: RecordId): Form | undefined {
  return portalForms(forms).find((form) => form.id === formId)
}

export type PortalFormTab = 'all' | 'contact' | 'group' | 'submission'

/** Tab id, label and predicate together, so nothing looks a label up by a computed key. */
const TABS: readonly {
  id: PortalFormTab
  label: string
  keep: (card: PortalFormCardView) => boolean
}[] = [
  { id: 'all', label: 'All Forms', keep: () => true },
  { id: 'contact', label: 'Contact Forms', keep: (card) => card.entityType === 'contact' },
  { id: 'group', label: 'Group Forms', keep: (card) => card.entityType === 'group' },
  { id: 'submission', label: 'Submission Forms', keep: (card) => card.entityType === 'submission' },
]

export type PortalFormTabView = { id: PortalFormTab; label: string; count: number }

export type PortalFormCardView = {
  id: RecordId
  name: string
  /**
   * Absent when the column is blank, and NOT defaulted to `contact`.
   *
   * A blank type is a row nothing can fan out, because the fan-out needs to know whether the
   * to-do hangs off a person or a session, so the card says so and the assign action refuses.
   * Defaulting would make a broken row look like a contact form and quietly send it to every
   * accepted speaker.
   */
  entityType?: TaskEntityType
  /** `Contact`, `Group` or `Session`, per ref 25's metadata row. */
  typeLabel: string
  status: Form['status']
  /** How many questions the form asks. A form with none cannot be completed. */
  questions: number
  /** The welcome body as one line of text, for the snippet under the name. */
  instructions?: string
  /** How far the fan-out got: distinct assignments off this form's task, and how many done. */
  assigned: number
  done: number
}

export function toPortalFormCards(input: {
  forms: readonly Form[]
  /** The event's tasks, so a form's own form-kind task can be found and counted. */
  tasks: readonly Task[]
  assignments: readonly TaskAssignment[]
}): readonly PortalFormCardView[] {
  const counts = countByForm(input)

  return portalForms(input.forms).map((form) => {
    const tally = counts.get(form.id)
    return {
      id: form.id,
      name: form.name,
      entityType: form.entityType,
      typeLabel: form.entityType === undefined ? NO_TYPE_LABEL : TASK_TYPE_LABELS[form.entityType],
      status: form.status,
      questions: form.fields.length,
      instructions: plainText(form.welcomeHtml),
      assigned: tally?.assigned ?? 0,
      done: tally?.done ?? 0,
    }
  })
}

/**
 * Assignment counts per FORM, reached through the tasks that link it.
 *
 * Two hops rather than one, because a portal form is never assigned directly: assigning
 * creates a form-kind `Task` pointing at it and then one `TaskAssignments` row per tuple, so
 * the number an organizer wants on the form card lives two tables away.
 *
 * Deduplicated on the uniqueness tuple the same way `dedupeAssignments` does, so this card and
 * the task card behind it cannot disagree about how many to-dos one form created. Done wins a
 * tie, for the reason given there: chasing somebody for work already delivered is the worse
 * failure.
 */
function countByForm(input: {
  tasks: readonly Task[]
  assignments: readonly TaskAssignment[]
}): ReadonlyMap<RecordId, { assigned: number; done: number }> {
  const formByTask = new Map(
    input.tasks
      .filter((task) => task.formId !== undefined)
      .map((task) => [task.id, task.formId as RecordId]),
  )
  const bestByTuple = new Map<string, { formId: RecordId; done: boolean }>()

  for (const assignment of input.assignments) {
    const formId = formByTask.get(assignment.taskId)
    if (formId === undefined) continue
    const key = `${assignment.taskId}|${assignment.speakerId}|${assignment.submissionId ?? ''}`
    const done = assignment.status === 'done'
    const existing = bestByTuple.get(key)
    if (existing === undefined || (!existing.done && done)) bestByTuple.set(key, { formId, done })
  }

  const counts = new Map<RecordId, { assigned: number; done: number }>()
  for (const entry of bestByTuple.values()) {
    const tally = counts.get(entry.formId) ?? { assigned: 0, done: 0 }
    tally.assigned += 1
    if (entry.done) tally.done += 1
    counts.set(entry.formId, tally)
  }
  return counts
}

/**
 * The welcome body as text.
 *
 * Stored as HTML, because step 2's `Description & Instructions` control is a rich text editor.
 * A card shows one line, and a snippet of markup would render tag names, so the tags come off
 * here rather than at the component. Not a sanitizer and not pretending to be one: the portal
 * renders the description as text too (`answers-view.htmlToText` says why).
 */
function plainText(html: string | undefined): string | undefined {
  if (html === undefined) return undefined
  const text = html
    // Block ends become a space so two paragraphs do not run into one word; every other tag
    // goes to nothing so `<strong>now</strong>.` does not become `now .`.
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length === 0 ? undefined : text
}

/** The tab strip with its live counts, e.g. `All Forms 3`, `Contact Forms 1`. */
export function portalFormTabs(cards: readonly PortalFormCardView[]): readonly PortalFormTabView[] {
  return TABS.map((tab) => ({ id: tab.id, label: tab.label, count: cards.filter(tab.keep).length }))
}

/** The search box and the tab strip, applied together. */
export function filterPortalFormCards(
  cards: readonly PortalFormCardView[],
  tab: PortalFormTab,
  search: string,
): readonly PortalFormCardView[] {
  const keep = TABS.find((candidate) => candidate.id === tab)?.keep ?? (() => true)
  const needle = search.trim().toLowerCase()

  return cards.filter((card) => {
    if (!keep(card)) return false
    if (needle.length === 0) return true
    // Name and snippet both, because both are text the organizer can see on the card.
    return `${card.name} ${card.instructions ?? ''}`.toLowerCase().includes(needle)
  })
}
