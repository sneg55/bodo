'use client'

// The 3-step portal form wizard: header, step rail, step pane, sticky footer (refs 27-29).
//
// One piece of client state, the whole draft, and one write that saves all of it, for the reason
// `FormEditor` gives: the question list and the conditions that point into it have to agree with
// each other, so a per-step autosave would let a `showIf` reach Airtable before the question it
// fires on.
//
// Two modes off ref 27 and ref 28. In CREATE mode there is no record yet, so the header reads
// `Create Form` with a `Create` button and steps 2 and 3 are rendered disabled: a question has
// nothing to belong to until the row exists. In EDIT mode the header reads `Edit Form` over the
// form's internal name, with `Duplicate`, `Delete` and `Save`, and every step is reachable.

import { ArrowLeftIcon, CopyIcon, SaveIcon, Trash2Icon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { FormDraft } from '@/features/forms/builder/draft'
import { applyPatch, type DraftPatch } from '@/features/forms/builder/draft-edits'
import {
  createPortalFormAction,
  deletePortalFormAction,
  duplicatePortalFormAction,
  savePortalFormAction,
} from '@/features/portal-forms/actions'
import { isPortalStepComplete, STEP_INCOMPLETE_HELP } from '@/features/portal-forms/form-draft'

import { EditorRail } from '../forms/[formId]/EditorRail'
import { DeletePortalFormDialog } from './DeletePortalFormDialog'
import { PORTAL_EDITOR_LAST_STEP, PORTAL_EDITOR_STEPS } from './editor-steps'
import { PortalStepBody } from './PortalStepBody'

export type PortalFormEditorProps = {
  eventId: string
  /** Absent in create mode, which is the only difference the two modes turn on. */
  formId?: string
  initialDraft: FormDraft
}

export function PortalFormEditor({ eventId, formId, initialDraft }: PortalFormEditorProps) {
  const router = useRouter()
  const [draft, setDraft] = useState(initialDraft)
  const [step, setStep] = useState(1)
  const [visited, setVisited] = useState<readonly number[]>([1])
  const [unsaved, setUnsaved] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()
  // The draft as of the last edit, which state alone cannot give: an edit made in the same
  // task as the click that saves has not been re-rendered yet, so the closure's `draft` is one
  // edit behind and the save would store the older one. Same ref, same reason, as `FormEditor`.
  const live = useRef(initialDraft)

  const creating = formId === undefined
  const listHref = `/admin/${eventId}/portal-forms`
  const stepReady = isPortalStepComplete(draft, step)
  const setupReady = isPortalStepComplete(draft, 1)

  function patch(next: DraftPatch): void {
    const merged = applyPatch(live.current, next)
    live.current = merged
    setUnsaved(true)
    setDraft(merged)
  }

  function go(next: number): void {
    setStep(next)
    setVisited((current) => (current.includes(next) ? current : [...current, next]))
  }

  function create(): void {
    start(async () => {
      const sent = live.current
      const result = await createPortalFormAction({ eventId, draft: sent })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // The push below lands on the new record's editor, which loads what was STORED, so an
      // edit made while the create was in flight is about to disappear off the screen as well
      // as out of the record. Saying so is the difference between a bug and a surprise.
      if (live.current === sent) {
        setUnsaved(false)
        toast.success('Saved successfully', { description: 'Your changes have been saved.' })
      } else {
        toast.warning('Form created, but what you changed while it saved is not in it.')
      }
      router.push(`${listHref}/${result.formId}`)
    })
  }

  /** The save itself, awaited by the buttons that must not act on a stale record. */
  async function persist(id: string): Promise<boolean> {
    const sent = live.current
    const result = await savePortalFormAction({ eventId, formId: id, draft: sent })
    if (!result.ok) {
      toast.error(result.message)
      return false
    }
    for (const warning of result.warnings) toast.warning(warning)
    // Only what was SENT is stored. An edit made while the write was in flight is not, and a
    // flat "Saved successfully" over it is how an organizer loses a question still on screen.
    if (live.current !== sent) {
      toast.warning(
        'Saved, but you changed the form while it was saving. Save again to store that.',
      )
      return true
    }
    setUnsaved(false)
    // Verbatim off ref 29's toast, including its `View All Forms` action.
    toast.success('Saved successfully', {
      description: 'Your changes have been saved.',
      action: { label: 'View All Forms', onClick: () => router.push(listHref) },
    })
    // Deliberately no `router.refresh()`: the action already expired the tags this write
    // affects, and refreshing remounts this editor, which throws the organizer back to step 1
    // and discards any edit made since. Same note as `FormEditor`.
    return true
  }

  function save(): void {
    if (formId === undefined) return
    start(async () => {
      await persist(formId)
    })
  }

  /**
   * Duplicate saves first when there is anything unsaved, and that is not a convenience.
   *
   * `duplicatePortalFormAction` copies from STORAGE, on purpose, so that duplicating never
   * saves unsaved edits as a side effect. Combined with the `router.push` below that made it
   * the portal's version of publishing an unsaved form: the copy silently came out as the
   * version before the organizer's edits, the navigation threw those edits away, and the only
   * thing on screen said "Form duplicated".
   */
  function duplicate(): void {
    if (formId === undefined) return
    start(async () => {
      if (unsaved && !(await persist(formId))) return
      const result = await duplicatePortalFormAction({ eventId, formId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Form duplicated')
      router.push(`${listHref}/${result.formId}`)
    })
  }

  /**
   * Deleting is the one place unsaved edits are correctly discarded: the record they belong to
   * is being destroyed on purpose, so saving first would be busywork against a row about to
   * disappear. If the action refuses (an assigned form), it returns before the push and the
   * edits stay where they are.
   */
  function remove(): void {
    if (formId === undefined) return
    setConfirming(false)
    start(async () => {
      const result = await deletePortalFormAction({ eventId, formId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Form deleted')
      router.push(listHref)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{creating ? 'Create Form' : 'Edit Form'}</h1>
          {creating ? null : <p className="truncate text-sm text-muted-foreground">{draft.name}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Nothing else here says a change is only in the browser, and the editor holds the
              whole draft in memory until Save, so leaving the page loses it. The badge is the
              warning; Duplicate saving first is the safety net. */}
          {unsaved ? <Badge variant="secondary">Unsaved changes</Badge> : null}
          {creating ? (
            <Button disabled={pending || !setupReady} onClick={create}>
              <SaveIcon />
              Create
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={pending} onClick={duplicate}>
                <CopyIcon />
                Duplicate
              </Button>
              <Button variant="destructive" disabled={pending} onClick={() => setConfirming(true)}>
                <Trash2Icon />
                Delete
              </Button>
              <Button disabled={pending} onClick={save}>
                <SaveIcon />
                Save
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="flex flex-col gap-2">
          <ButtonLink href={listHref} variant="ghost" size="sm" className="self-start">
            <ArrowLeftIcon />
            Back to forms
          </ButtonLink>
          <EditorRail
            steps={PORTAL_EDITOR_STEPS}
            current={step}
            visited={visited}
            disabled={creating ? [2, 3] : []}
            onSelect={go}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {/* Padded, because the footer below is sticky and would otherwise sit on top of the
              last card in the step rather than under it. */}
          <PortalStepBody step={step} draft={draft} patch={patch} />

          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background py-3">
            <Button variant="outline" disabled={step === 1} onClick={() => go(step - 1)}>
              Back
            </Button>
            <span className="flex items-center gap-3">
              {stepReady ? null : (
                <span className="text-xs text-muted-foreground">{STEP_INCOMPLETE_HELP}</span>
              )}
              {step === PORTAL_EDITOR_LAST_STEP ? (
                <Button disabled={pending} onClick={save}>
                  <SaveIcon />
                  Save
                </Button>
              ) : (
                // In create mode `Next` creates the record, because creating it is the only
                // thing that can make step 2 reachable: a question needs a form to belong to.
                // A Next that could only ever be disabled would be a control that does
                // nothing, which is worse than one that does the obvious thing.
                <Button
                  disabled={!stepReady || pending}
                  onClick={() => {
                    if (creating) create()
                    else go(step + 1)
                  }}
                >
                  Next
                </Button>
              )}
            </span>
          </div>
        </div>
      </div>

      <DeletePortalFormDialog
        open={confirming}
        name={draft.name}
        pending={pending}
        onOpenChange={setConfirming}
        onConfirm={remove}
      />
    </div>
  )
}
