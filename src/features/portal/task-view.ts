// Task assignments flattened for the client.
//
// The Tasks card and the tasks page are interactive (tabs, a Filter menu, Open All and
// Collapse All), so they are client components, and everything crossing that boundary
// is serialized into the RSC payload. Sending `PortalTaskItem` would send the whole
// Task record plus the whole assignment for every row; this sends only what the UI
// renders. BUILD_SPEC 6.3 scores payload discipline, and a task list is where a
// codebase either respects it or does not.
//
// Pure, so the mapping is asserted directly rather than through a rendered accordion.

import type { FormAnswers } from '@/features/forms/logic'
import { submissionCardTitle } from '@/features/portal/own-submissions'
import type { PortalTaskItem } from '@/features/portal/ports'
import { formatFileSize, portalFileHref } from '@/features/portal/submission-files'
import type { TaskKind } from '@/features/portal/task-completion'
import { answersForFields } from '@/features/portal-forms/answers'
import type { StoredFile, SubmissionWithParticipants, Task } from '@/types/domain'
import type { Form, FormField } from '@/types/forms'

export type TaskScope = 'mine' | 'submission'

export type TaskView = {
  assignmentId: string
  taskId: string
  title: string
  description?: string
  kind: TaskKind
  scope: TaskScope
  /** `SESS-3 - Why agent plans fail halfway`, for a submission-scoped task. */
  submissionLabel?: string
  submissionCode?: string
  /** Pre-formatted on the server so the client cannot render a different date. */
  dueLabel?: string
  done: boolean
  /**
   * What a COMPLETED upload task actually received, so the row can show it.
   *
   * A finished upload task used to render one sentence, "This task is already complete.", and
   * nothing else: no filename, no size, no way to open what had been sent. The 2026-08-12 eval
   * run recorded a speaker uploading a headshot successfully and then having no way to see it
   * anywhere in the portal, which reads as an upload that went nowhere. Absent for every other
   * kind, and for an upload whose stored id no longer resolves. Tolerates the R2 object key
   * that completions written before `TaskCompletion` was corrected stored in its place.
   */
  completedFile?: { filename: string; sizeLabel: string; href?: string }
  /** Ref 25 renders a manual task as a `Manual` chip. See `isManualTask`. */
  manual: boolean
  /**
   * `kind: 'form'` only: the organizer's instructions for this form, as authored HTML.
   *
   * Carried because it was NOT, and the portal form builder's step 2 tells the organizer their
   * `Description & Instructions` will appear above the questions their speakers answer. It did
   * not: this mapper copied only the form's fields, so everything typed into that editor was
   * invisible to the one person it was written for. Found by Codex review while auditing the
   * shared editor's call sites, which is exactly the kind of gap a control with no reader makes.
   */
  instructionsHtml?: string
  /**
   * `kind: 'form'` only: the linked form's questions, whole.
   *
   * The FULL `FormField`, not a flattened subset, and the extra payload is the point rather
   * than an oversight. The control is the shared `FieldControl` the CFP wizard and the portal's
   * submission editor already use, and it needs `help`, `showIf` and `options` to render the
   * question the organizer built: without `showIf` a conditional question would be shown
   * unconditionally here and then validated conditionally on the server, and without `options`
   * a dropdown would render empty. The flattened `TaskFieldView` this replaced carried neither,
   * which is why the old control could only draw a text box.
   */
  fields: readonly FormField[]
  /**
   * `kind: 'form'` only: the answers already saved on this assignment, restricted to questions
   * the form still asks. See `answersForFields`.
   */
  answers: FormAnswers
  /**
   * `kind: 'form'` only: the task links a form that no longer resolves, or links none at all.
   *
   * Rendered as a message rather than as an empty question list, because the two are
   * indistinguishable to a speaker and `buildCompletion` raises on this case: a Complete button
   * over nothing would fail with a redacted digest.
   */
  formMissing: boolean
  /** `kind: 'link'` only. See `linkFromDescription`. */
  linkUrl?: string
}

/**
 * The four fields that only mean anything for a form-kind task.
 *
 * Extracted because inlining them pushed the mapper past the complexity ceiling the lint config
 * enforces, and because `kind === 'form'` was being asked four times in a row for four values
 * that stand or fall together.
 */
function formParts(
  kind: TaskKind,
  form: Form | undefined,
  answers: Record<string, unknown> | undefined,
): Pick<TaskView, 'fields' | 'instructionsHtml' | 'answers' | 'formMissing'> {
  if (kind !== 'form') return { fields: [], answers: {}, formMissing: false }

  return {
    fields: form?.fields ?? [],
    instructionsHtml: form?.welcomeHtml,
    answers: answersForFields(form?.fields ?? [], answers),
    // A form-kind task whose form was deleted or retyped: the caller renders a stated
    // problem rather than an empty question list.
    formMissing: form === undefined,
  }
}

/**
 * Is this the kind of task ref 25's `Manual` chip describes?
 *
 * **`origin` on its own is not the answer, and reading it as though it were is what put a
 * `Manual` chip on a form.** Two things make that easy to hit. `origin` defaults to
 * `manual` when the Airtable cell is blank (`mapTask` in mapping-portal.ts), so every task
 * created without the column set claims to be manual; and a `kind: 'form'` task is not a
 * manual anything from either side, since the speaker completes it by answering questions
 * rendered inline and the organizer authored it in the form builder. "Speaker Travel and
 * AV Form" was chipped `Manual` on the speaker's list and the organizer's at the same time
 * as it rendered its own questions.
 *
 * The chip's copy is untouched: `Manual` is transcribed and stays. What changes is which
 * tasks it is true of. The parity audit already records the direction, listing "other
 * values may exist (e.g. auto tasks tied to forms or file requests)" as an inference and
 * "meaning and alternatives of the `Manual` task chip" as an open ambiguity
 * (docs/parity/portal-tasks-forms.md), so a form-backed task carries no origin chip rather
 * than an invented one. The organizer's card already names the linked form beside the
 * title, which is the label that surface actually needed.
 *
 * Shared by the speaker's list and the organizer's, because a task chipped `Manual` on one
 * screen and not the other is worse than either answer on its own.
 */
export function isManualTask(task: Pick<Task, 'origin' | 'kind'>): boolean {
  return task.origin === 'manual' && task.kind !== 'form'
}

export function toTaskViews(input: {
  items: readonly PortalTaskItem[]
  submissions: readonly SubmissionWithParticipants[]
  forms: readonly Form[]
  /** The event's timezone, so a due date reads the same here and admin-side. */
  timeZone: string
  /**
   * The speaker's own uploads, so a completed upload task can name the file it received.
   * Optional: a caller with no file list simply renders the task without one.
   */
  files?: readonly StoredFile[]
}): readonly TaskView[] {
  const submissionById = new Map(input.submissions.map((row) => [row.id, row]))
  const formById = new Map(input.forms.map((form) => [form.id, form]))
  const fileById = new Map((input.files ?? []).map((file) => [file.id, file]))
  // Keyed by object key as well, because a completion written before `TaskCompletion` was
  // corrected stored the R2 OBJECT KEY in `fileId` rather than the `Files` record id, and
  // those rows are still in the base. Both lookups are exact; neither can match the other's
  // shape by accident, since a record id has no slashes and an object key always does.
  const fileByObjectKey = new Map((input.files ?? []).map((file) => [file.objectKey, file]))

  return input.items.map((item) => {
    const submission =
      item.assignment.submissionId === undefined
        ? undefined
        : submissionById.get(item.assignment.submissionId)
    const form = item.task.formId === undefined ? undefined : formById.get(item.task.formId)

    return {
      assignmentId: item.assignment.id,
      taskId: item.task.id,
      title: item.task.title,
      description: item.task.description,
      kind: item.task.kind,
      scope: item.task.entityType === 'submission' ? 'submission' : 'mine',
      submissionLabel: submission === undefined ? undefined : submissionCardTitle(submission),
      submissionCode: submission?.code,
      dueLabel: formatDue(item.task.dueAt, input.timeZone),
      done: item.assignment.status === 'done',
      ...completedFilePart(item, fileById, fileByObjectKey),
      manual: isManualTask(item.task),
      ...formParts(item.task.kind, form, item.assignment.answers),
      linkUrl: item.task.kind === 'link' ? linkFromDescription(item.task.description) : undefined,
    }
  })
}

/**
 * The file a completed upload task received, resolved from the `fileId` the completion stored.
 *
 * Silent unless all three hold: the task is an upload, it is done, and its stored id resolves
 * to one of the speaker's own files. A row whose file was deleted in Airtable therefore loses
 * the line rather than rendering a dead link, which is the same call `SubmissionFiles` makes.
 */
function completedFilePart(
  item: PortalTaskItem,
  fileById: ReadonlyMap<string, StoredFile>,
  byObjectKey: ReadonlyMap<string, StoredFile>,
): { completedFile?: TaskView['completedFile'] } {
  if (item.task.kind !== 'upload' || item.assignment.status !== 'done') return {}
  const stored = item.assignment.answers?.fileId
  if (typeof stored !== 'string' || stored === '') return {}
  const file = fileById.get(stored) ?? byObjectKey.get(stored)
  if (file === undefined) return {}

  // Always the authenticated route, never the bucket: an answered upload is private
  // (`visibilityFor`), and `portalFileHref` re-derives ownership from the session.
  return {
    completedFile: {
      filename: file.filename,
      sizeLabel: formatFileSize(file.size),
      // No submission code: `getOwnFile` then searches the caller's OWN uploads, which is
      // the narrower set and the right one here, since a task upload is always their own.
      href: portalFileHref(file.id),
    },
  }
}

/**
 * Formatted in the event's timezone on the server. A client-side `toLocaleDateString`
 * would render the viewer's zone and disagree with every admin screen about which day
 * a deadline falls on.
 */
export function formatDue(dueAt: string | undefined, timeZone: string): string | undefined {
  if (dueAt === undefined) return undefined
  const parsed = new Date(dueAt)
  if (Number.isNaN(parsed.getTime())) return undefined
  return `Due ${new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(parsed)}`
}

/**
 * The URL a `kind: 'link'` task wants visited.
 *
 * The Tasks schema (BUILD_SPEC 3) has no url column: it has title, description,
 * entityType, origin, kind, form, dueAt and appliesTo. So the link lives in the
 * description, which is where an organizer would put it anyway, and it is extracted
 * rather than guessed at render time. Only http and https are accepted, because this
 * string ends up in an href and `javascript:` in an organizer-authored field would be
 * a script that runs in the speaker's session.
 */
export function linkFromDescription(description: string | undefined): string | undefined {
  if (description === undefined) return undefined
  return /https?:\/\/[^\s<>"']+/.exec(description)?.[0]
}
