'use client'

// The editor shell: header, step rail, step content, sticky footer (parity refs 06-15).
//
// One piece of client state, the whole draft, and one write that saves all of it. That is
// not a shortcut: the field list, the routing rules that point into it and the roles the
// participant step enforces have to agree with each other, so a per-step autosave would
// let a routing rule reach Airtable before the question it fires on.
//
// Publish and unpublish live in this header, which the screenshots do not show. They are
// here because the public page renders only a published form (`publicFormGate`), so
// without them nothing built in this UI could ever be reached by a speaker.

import { ArrowLeftIcon, ExternalLinkIcon, LinkIcon, SaveIcon } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { saveFormAction, setFormStatusAction } from '@/features/forms/builder/actions'
import { checkDraft } from '@/features/forms/builder/checks'
import type { NamedOption } from '@/features/forms/builder/defaults'
import { type FormDraft, normalizeFields } from '@/features/forms/builder/draft'
import { applyPatch, type DraftPatch } from '@/features/forms/builder/draft-edits'
import { fillEmptyHeadings, headingsOf } from '@/features/forms/builder/heading-defaults'
import type { RecipientOption } from '@/features/team/recipients'

import { EditorRail } from './EditorRail'
import { EditorStepBody } from './EditorStepBody'
import { stepNeighbour, visibleSteps } from './editor-steps'
import { StepProblems } from './StepProblems'

export type FormEditorProps = {
  eventId: string
  formId: string
  /** The event's IANA zone. Step 6's close date is a wall clock in it. See `StepProps`. */
  eventTimeZone: string
  eventSlug: string
  publicId: string
  status: 'draft' | 'published'
  initialDraft: FormDraft
  trackOptions: readonly NamedOption[]
  /** This event's tags, for the Tags question's category picker. See option-sources.ts. */
  tagOptions: readonly NamedOption[]
  /** The event team, as the notifications step's recipient suggestions. */
  recipients: readonly RecipientOption[]
}

export function FormEditor(props: FormEditorProps) {
  const [draft, setDraft] = useState(props.initialDraft)
  const [status, setStatus] = useState(props.status)
  const [step, setStep] = useState(1)
  const [visited, setVisited] = useState<readonly number[]>([1])
  const [unsaved, setUnsaved] = useState(false)
  const [pending, start] = useTransition()
  // The draft as of the last edit, which state alone cannot give: an edit made in the same
  // task as the click that saves has not been re-rendered yet, so the closure's `draft` is
  // one edit behind and the save would store the older one. Writing both keeps what is sent
  // equal to what is on screen. Every write to either goes through `patch`.
  const live = useRef(props.initialDraft)

  const steps = visibleSteps(draft)
  const publicHref = `/submit/${props.eventSlug}/${props.publicId}`
  const isLast = step === steps.at(-1)?.index

  // The same check the Server Action runs, on the same normalized draft, so what is on
  // screen cannot disagree with what the save enforces. `normalizeFields` is applied for
  // exactly the reason `saveFormAction` applies it: two option values differing only in
  // whitespace are one value once stored, and validating the raw draft misses that.
  //
  // Recomputed only when the draft changes: `patch` replaces it wholesale, and this walks
  // every question, every condition and every routing rule.
  const problems = useMemo(
    () =>
      checkDraft(
        {
          ...draft,
          fields: normalizeFields(draft.fields),
          participantFields: normalizeFields(draft.participantFields),
        },
        props.trackOptions.map((option) => option.value),
        props.tagOptions.map((option) => option.value),
      ),
    [draft, props.trackOptions, props.tagOptions],
  )

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

  /**
   * The save itself, awaited by both buttons. Returns whether the draft is now stored.
   *
   * What is SENT is `live.current`, not the rendered `draft`: see the note on that ref.
   */
  async function persist(): Promise<boolean> {
    // The eight participant-facing strings all carry a red asterisk, and on a form that
    // predates those columns all eight are empty, so Save used to report "Saved
    // successfully" over required fields that were still blank. They are filled with the
    // wording their own placeholder shows, which is also what the public wizard falls back
    // to, so the visitor sees no change and the form now holds what it claims to require.
    // Applied to the draft as well as to what is sent, so the inputs show what was stored,
    // and narrowed by `headingsOf` so that merge carries the eight strings and nothing else.
    const sending = live.current
    const { headings, filled } = fillEmptyHeadings(headingsOf(sending), sending.participantsEnabled)
    if (filled.length > 0) patch(headings)
    // Read back AFTER the fill, so the identity below compares against exactly what went out.
    const sent = live.current

    const result = await saveFormAction({
      eventId: props.eventId,
      formId: props.formId,
      draft: sent,
    })
    if (!result.ok) {
      toast.error(result.message)
      return false
    }
    // Deliberately no warning toasts. Saving used to raise one per `checkDraft` warning on
    // every save, which meant a standing condition on a question the organizer had not
    // touched ("Tags" offering none of the event's categories) was announced again every
    // time they changed the close date, from a step where no question can be opened. The
    // CFP-02 evaluation reported exactly that. The warnings are still computed, from the
    // same function, and now render on the step that owns them (`StepProblems`) where the
    // question is one press away. Errors are unaffected: they refuse the save and come back
    // as `result.message` above.
    //
    // Only what was SENT is stored. An edit made while the write was in flight is not, and
    // reporting a flat "Saved successfully" over it is how an organizer loses a question
    // they can still see on screen: they read the toast, navigate away, and it is gone.
    if (live.current === sent) {
      setUnsaved(false)
      toast.success('Saved successfully', {
        description:
          filled.length === 0 ? undefined : `Filled in the default ${filled.join(', ')}.`,
      })
    } else {
      toast.warning(
        'Saved, but you changed the form while it was saving. Save again to store that.',
      )
    }
    // Deliberately no `router.refresh()`. The action already expired the tags this write
    // affects, and `revalidateTag` marks the path revalidated, which is what tells the
    // client router its cache is stale. Refreshing on top of that remounted this editor,
    // which threw the organizer back to step 1 and discarded any edit made since.
    return true
  }

  function save(): void {
    start(async () => {
      await persist()
    })
  }

  /**
   * Publish saves first when there is anything unsaved, and that is not a convenience.
   *
   * `setFormStatusAction` writes the status column and validates what is STORED, so
   * publishing an edited-but-unsaved form put a DIFFERENT version of the form in front of
   * strangers than the one on screen, reported "Form published", and left the edits to be
   * lost on the next navigation.
   */
  function togglePublished(): void {
    const next = status === 'published' ? 'draft' : 'published'
    start(async () => {
      if (next === 'published' && unsaved && !(await persist())) return
      const result = await setFormStatusAction({
        eventId: props.eventId,
        formId: props.formId,
        status: next,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setStatus(next)
      toast.success(next === 'published' ? 'Form published' : 'Form unpublished')
    })
  }

  function copyLink(): void {
    const url = new URL(publicHref, window.location.origin).toString()
    void navigator.clipboard.writeText(url).then(
      () => toast.success('Link copied'),
      () => toast.error(`Could not copy. The link is ${url}`),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">
            {draft.entityKind === 'sessions' ? 'Edit Session Form' : 'Edit Abstract Form'}
          </h1>
          <p className="truncate text-sm text-muted-foreground">{draft.name}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Nothing else on this screen says a change is only in the browser, and the
              editor keeps the whole draft in memory until Save, so leaving the page loses
              it. The badge is the warning; Publish saving first is the safety net. */}
          {unsaved ? <Badge variant="secondary">Unsaved changes</Badge> : null}
          <ButtonLink
            href={publicHref}
            target="_blank"
            rel="noreferrer"
            variant="outline"
            disabled={status !== 'published'}
          >
            <ExternalLinkIcon />
            View Form
          </ButtonLink>
          <Button variant="outline" onClick={copyLink}>
            <LinkIcon />
            Copy Link
          </Button>
          <Button variant="outline" disabled={pending} onClick={togglePublished}>
            {status === 'published' ? 'Unpublish' : 'Publish'}
          </Button>
          <Button disabled={pending} onClick={save}>
            <SaveIcon />
            Save
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="flex flex-col gap-2">
          <ButtonLink
            href={`/admin/${props.eventId}/forms`}
            variant="ghost"
            size="sm"
            className="self-start"
          >
            <ArrowLeftIcon />
            Back to forms
          </ButtonLink>
          <EditorRail steps={steps} current={step} visited={visited} onSelect={go} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {/* Padded, because the footer below is sticky and would otherwise sit on top of
              the last card in the step rather than under it. */}
          <div className="flex flex-col gap-4 pb-4">
            <StepProblems problems={problems} step={step} steps={steps} onSelect={go} />
            <EditorStepBody
              step={step}
              eventId={props.eventId}
              eventTimeZone={props.eventTimeZone}
              draft={draft}
              patch={patch}
              trackOptions={props.trackOptions}
              tagOptions={props.tagOptions}
              recipients={props.recipients}
              steps={steps}
            />
          </div>

          <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-background py-3">
            <Button
              variant="outline"
              disabled={step === steps.at(0)?.index}
              onClick={() => go(stepNeighbour(steps, step, -1))}
            >
              Back
            </Button>
            {isLast ? (
              <Button disabled={pending} onClick={save}>
                <SaveIcon />
                Save
              </Button>
            ) : (
              <Button onClick={() => go(stepNeighbour(steps, step, 1))}>Next</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
