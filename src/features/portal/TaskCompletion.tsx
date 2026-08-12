'use client'

// The completion control, one shape per task kind (BUILD_SPEC 5.6: upload, form, link,
// confirm). The only client component in the task tree that holds state, and it holds as
// little as possible: the submit transition, and for an upload the `Files` record id the
// upload route handed back.
//
// The upload goes to /api/files/upload rather than through this action, because a
// Server Action receives its body already buffered into a FormData and a 25 MB file
// buffered on a Worker is the failure BUILD_SPEC 5.2 designed the streaming route to
// avoid. The file is sent first, and only its identifier travels through the action -
// twice, since CNT-02: once into `saveTaskUploadAction` the moment the upload succeeds, so
// a reload before `Mark complete` has something server-side to recover, and again on the
// completion post itself.
//
// `router.refresh()` AFTER A COMPLETION, which every sibling that marks portal work done
// already did and this one did not: `RequestedFilesPanel` refreshes after an upload,
// `HeadshotUpload` after a headshot. The write itself is sound - `setTaskAssignmentStatus`
// stores `status: done` and expires `speaker:{id}:tasks`, the tag
// `listTaskAssignmentsForSpeaker` declares - so the tick was durable and survived a reload.
// What was missing is the reload: expiring a server cache entry does not rerun the client
// router, so the item this control sits under kept rendering the payload it was given, with
// its `Pending` badge and its form still open, until the speaker navigated or refreshed by
// hand. A completion that looks like it did nothing is one a speaker presses again. This is
// the one line that turns the expired tag into a new server render.
//
// NOTHING HERE IS PRESSABLE BEFORE HYDRATION, and that is the second half of the same
// complaint. This is a submit HANDLER on a form with no `action`, so a press that lands
// before React attaches it submits nothing, posts nothing and says nothing: the eval run of
// 2026-08-11 recorded exactly that as "a manual task fails silently". The controls now
// declare that they are not ready yet instead of accepting a press they will drop.
// ./use-hydrated.ts is the whole argument.

import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { FileInput } from '@/components/primitives/FileInput'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { completeTaskAction, saveTaskUploadAction } from '@/features/portal/actions'
import { TaskFormAnswers } from '@/features/portal/TaskFormAnswers'
import { completionPrompt } from '@/features/portal/task-completion'
import type { TaskView } from '@/features/portal/task-view'
import { uploadFile, uploadKindFor } from '@/features/portal/upload-client'
import { useHydrated } from '@/features/portal/use-hydrated'
import { uploadHint } from '@/services/storage/upload-hint'

/**
 * The kinds an upload TASK may receive, matched to `uploadKindFor`'s classification, and the
 * same three `RequestedFilesPanel` already states for the identical `FileInput` on the file
 * request path. One call so the accepted-type sentence can never read differently for the two
 * upload paths the portal has. Filed for CNT-06: this control used to carry no `accept` and no
 * constraint text at all, so the caps `checkUploadAllowed` was already enforcing were invisible
 * until a file was chosen and refused.
 */
const UPLOAD_TASK_HINT = uploadHint('image', 'slides', 'doc')

export type TaskCompletionProps = {
  task: TaskView
  /**
   * Called once the completion has been STORED, so the row above can show itself as done
   * without waiting for the refresh below to come back from Airtable. See `TaskItem`.
   */
  onCompleted: () => void
}

export function TaskCompletion({ task, onCompleted }: TaskCompletionProps) {
  // A form task is its own control, in ./TaskFormAnswers.tsx, because it is the one kind with
  // something partial to keep: it holds an answer set and offers Save alongside Mark complete,
  // where the other three have a single value that is either given or not. Delegated rather than
  // branched inline so neither component carries the other's state.
  if (task.kind === 'form') return <TaskFormAnswers task={task} onCompleted={onCompleted} />
  return <SingleValueCompletion task={task} onCompleted={onCompleted} />
}

function SingleValueCompletion({ task, onCompleted }: TaskCompletionProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // The `Files` record id the upload route creates, not the R2 object key: this is what
  // `buildCompletion` stores as completion evidence and what `saveTaskUploadAction` persists
  // below, so it has to be the id that actually resolves to a row.
  const [fileId, setFileId] = useState('')
  const ready = useHydrated()
  const busy = pending || !ready

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await completeTaskAction(formData)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      // The row switches to its completed state HERE, not when the refresh returns. The
      // write is stored by the time this line runs, and the refresh behind it is a round
      // trip to Airtable: leaving the badge on `Pending` and this button on `Saving` for the
      // length of it is what made a successful completion look like it had hung.
      onCompleted()
      // The action has already expired this speaker's task tag, so the next server render
      // reads the row as done. This is what makes one happen, and it is what reconciles the
      // section counts and the Filter tabs with the row above.
      router.refresh()
    })
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (file === undefined) return
    startTransition(async () => {
      const stored = await uploadFile({
        file,
        kind: uploadKindFor(file.type),
        // Attaches the row to this task's submission, so it joins the deliverable's existing
        // version chain the way `RequestedFilesPanel`'s upload already does
        // (`versionGroupKey` groups by speaker + submission + kind). Without this the row had
        // no `submissionId` and landed alone: unbadged, unversioned. Filed as CNT-04.
        code: task.submissionCode,
      })
      if (!stored.ok) {
        toast.error(stored.message)
        return
      }
      setFileId(stored.fileId)
      toast.success('File uploaded.')

      // Persisted onto the assignment itself, not only kept here, for CNT-02: a reload wipes
      // this component's state, and `Mark complete` used to refuse a task whose file was
      // already attached because nothing server-side remembered which file the upload had
      // just produced. `completeTaskAction` falls back to reading this when the next post
      // carries no fileId of its own, so completion survives the reload, and an organizer
      // reviewing after the speaker has closed the tab sees the same evidence either way.
      const saved = await saveTaskUploadAction(uploadEvidence(task.assignmentId, stored.fileId))
      if (!saved.ok) {
        // The bytes are already stored and this session can still complete the task with the
        // `fileId` state set above; only a reload before `Mark complete` would lose the
        // recovery path, so this is a soft warning rather than a failed upload.
        console.error(`[portal] could not save upload evidence: ${saved.message}`)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input type="hidden" name="assignmentId" value={task.assignmentId} readOnly />
      <p className="text-xs font-medium text-muted-foreground">{completionPrompt(task.kind)}</p>

      {task.kind === 'upload' ? (
        <div className="space-y-2">
          <FileInput accept={UPLOAD_TASK_HINT.accept} onChange={handleFile} disabled={busy} />
          {/* The constraints, stated BEFORE a file is chosen, matching the identical control on
              `RequestedFilesPanel`. Enforced server-side since the upload route shipped and
              stated nowhere on this widget until CNT-06, so the only way to learn a file was
              too large or the wrong type was to be refused after picking it. */}
          <p className="text-pretty text-xs text-muted-foreground">{UPLOAD_TASK_HINT.text}</p>
          <Input type="hidden" name="fileId" value={fileId} readOnly />
        </div>
      ) : null}

      {task.kind === 'link' ? (
        <div className="space-y-2">
          {task.linkUrl === undefined ? null : (
            // NO hit area on this one, deliberately. It is 28px and it sits 8px above the
            // confirmation row, and `Checkbox` ships its own `after:-inset-y-2`, which
            // already reaches 6px up into that gap. There are 2px left, so growing this
            // control at all would put its target on top of the checkbox's, and a press in
            // the overlap lands on whichever won the stacking order. Widening the
            // `space-y-2` would fix it, and that is a layout decision, not this one.
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={task.linkUrl} rel="noreferrer noopener" target="_blank" />}
            >
              Open link
            </Button>
          )}
          <ConfirmBox label="I have visited the link" disabled={busy} />
        </div>
      ) : null}

      {task.kind === 'confirm' ? (
        <ConfirmBox label="I confirm this is done" disabled={busy} />
      ) : null}

      {/* 28px, 12px under whichever control the task kind put above it. For `confirm` that is
          the checkbox row, whose own hit area reaches 6px down out of it, so this band's 6px
          up meets it exactly and crosses nothing. */}
      <Button type="submit" size="sm" className="hit-area-y" disabled={busy} aria-busy={busy}>
        {completeLabel({ pending, ready })}
      </Button>
    </form>
  )
}

/** The two fields `saveTaskUploadAction` reads, built the same way `TaskFormAnswers` builds its. */
function uploadEvidence(assignmentId: string, fileId: string): FormData {
  const formData = new FormData()
  formData.set('assignmentId', assignmentId)
  formData.set('fileId', fileId)
  return formData
}

/**
 * `Mark complete` is the transcribed label and it is what the button reads whenever it can
 * actually complete anything. `Loading` is the only honest name for it before the handler
 * exists, and `Saving` is the state that was already here.
 */
function completeLabel(state: { pending: boolean; ready: boolean }): string {
  if (state.pending) return 'Saving'
  return state.ready ? 'Mark complete' : 'Loading'
}

/**
 * The checkbox posts through a hidden mirror rather than being read directly.
 * `Checkbox` is a Base UI primitive, not a host input, so it contributes no FormData
 * entry of its own, and a completion whose evidence never reached the server would
 * mark a speaker done over nothing.
 */
function ConfirmBox({ label, disabled }: { label: string; disabled: boolean }) {
  const [checked, setChecked] = useState(false)
  // `useId` and not a constant: several task rows can be open at once, and a repeated id
  // would point every label at the first checkbox on the page.
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={setChecked} disabled={disabled} />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      <Input type="hidden" name="confirmed" value={checked ? 'true' : 'false'} readOnly />
    </div>
  )
}
