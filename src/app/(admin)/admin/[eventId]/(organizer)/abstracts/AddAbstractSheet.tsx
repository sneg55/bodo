'use client'

// "+ Add Abstract": the right drawer with Details and Participants tabs.
//
// The drawer frame, the draft state and the commit live here; each tab's fields live in
// its own file (AbstractDetailsFields, AbstractParticipantRows) and the draft's rules in
// add-abstract-draft.ts. Control inventory and every label come from
// docs/parity/abstracts-review.md ref 23, verbatim. One documented addition:
//
//   - The Participants tab holds MORE THAN ONE participant. Ref 23 shows the tab but not
//     its contents (the parity doc lists that as an open question), and the abstracts
//     table has a Speaker column that is plural, so a drawer that could only ever attach
//     one person was the narrower guess. The first row stays the primary speaker, which
//     is what `manual-abstract.ts` writes as `submitter` and what Notify emails.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createAbstractAction } from '@/features/submissions/manual-abstract'

import { AbstractDetailsFields } from './AbstractDetailsFields'
import { AbstractParticipantRows } from './AbstractParticipantRows'
import {
  type AbstractDraft,
  EMPTY_ABSTRACT_DRAFT,
  type ExtraParticipant,
  missingFromAbstractDraft,
  toManualAbstractInput,
} from './add-abstract-draft'
import { LabeledInput } from './LabeledInput'

export function AddAbstractSheet({
  eventId,
  /** The event's own zone, which is what a typed Starts At and Ends At mean. */
  timeZone,
}: {
  eventId: string
  timeZone: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<AbstractDraft>(EMPTY_ABSTRACT_DRAFT)
  const [extras, setExtras] = useState<readonly ExtraParticipant[]>([])
  /** The last refusal, kept on the sheet. See `submit`. */
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof AbstractDraft>(key: K, value: AbstractDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const missing = missingFromAbstractDraft(draft, extras)

  const submit = () => {
    setProblem(undefined)
    startTransition(async () => {
      const result = await createAbstractAction(toManualAbstractInput(eventId, draft, extras))
      if (result.ok) {
        toast.success('Saved successfully')
        setDraft(EMPTY_ABSTRACT_DRAFT)
        setExtras([])
        setOpen(false)
        return
      }
      // Kept on the sheet as well as toasted. The sheet stays open on a refusal, which is
      // right, but a toast that has already faded leaves a full form and a button that
      // looks like it did nothing.
      setProblem(result.message)
      toast.error(result.message)
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>+ Add Abstract</Button>

      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg!">
        <SheetHeader>
          <SheetTitle>Add Abstract</SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="details" className="min-h-0 flex-1 px-4">
          <TabsList variant="line">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="participants">Participants</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="flex flex-col gap-3">
            <AbstractDetailsFields draft={draft} timeZone={timeZone} onChange={set} />
          </TabsContent>

          <TabsContent value="participants" className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              The first participant is the primary speaker and receives the acceptance or decline
              email, so an email address is required.
            </p>
            <LabeledInput
              id="abstract-email"
              label="Email"
              required
              placeholder="name@example.com"
              value={draft.email}
              onChange={(value) => set('email', value)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput
                id="abstract-first"
                label="First Name"
                value={draft.firstName}
                onChange={(value) => set('firstName', value)}
              />
              <LabeledInput
                id="abstract-last"
                label="Last Name"
                value={draft.lastName}
                onChange={(value) => set('lastName', value)}
              />
            </div>

            <AbstractParticipantRows extras={extras} onChange={setExtras} />
          </TabsContent>
        </Tabs>

        <SheetFooter className="flex-col items-stretch gap-3">
          {problem === undefined ? null : (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          {missing.length === 0 ? null : (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <p className="font-medium">
                {missing.length} {missing.length === 1 ? 'thing needs' : 'things need'} attention
              </p>
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {missing.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-row justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={missing.length > 0 || pending} onClick={submit}>
              Create Abstract
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
