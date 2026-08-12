'use client'

// Add one speaker by hand. SPK-01, SPK-02.
//
// The roster could be filled two ways, by a CFP submission or by a CSV, and neither is what
// an organizer does when somebody says yes over email. Pasting one person into a spreadsheet
// to import them back is a workaround for a missing button.
//
// The six inputs are in `AddSpeakerFields.tsx`; what is here is the part that used to lose
// data.
//
// TWO PRESSES FOR AN EXISTING PERSON. This sheet upserts by email, so an address already on
// the roster is an EDIT of that record. It used to perform that edit on the first press and
// report it as `Saved successfully`, which meant a returning speaker could be demoted from
// Confirmed to Prospect by the Status select's own default, with the only visible trace being
// the roster's Confirmed count going down by one. Now the first press for a known address
// writes NOTHING: the action answers with that person's name and current status, the alert
// below names them, and the button becomes `Update <name>`. The second press is the organizer
// saying yes to editing somebody who already exists.
//
// EMPTY IS ABSENT, not a clear, and the Status select counts as empty until it is opened.
// Every optional field is sent only when it was typed, and `status` only when the menu was
// used, so confirming an update cannot blank a company, delete a portal-written biography, or
// move somebody backwards through the process by omission. See add-speaker-draft.ts.
//
// THE RESULT SAYS WHICH THING HAPPENED. `Created` and `Updated` are different sentences,
// because "the roster count did not move" and "the roster count did not move because that
// address was already on it" are different facts about a run, and one sentence for both is
// how a create is never observed.

import { UserPlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { speakerStatusLabel } from '@/constants/status'
import { AddSpeakerFields } from '@/features/speakers/AddSpeakerFields'
import { addSpeakerAction } from '@/features/speakers/actions'
import {
  type AddSpeakerFormValues,
  EMPTY_ADD_SPEAKER_FORM,
  type KnownSpeaker,
} from '@/features/speakers/add-speaker-form'
import { textToBioHtml } from '@/features/speakers/bio-text'

export function AddSpeakerSheet({
  eventId,
  onAdded,
}: {
  eventId: string
  /** Called after a successful add so the roster can re-read from the server. */
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<AddSpeakerFormValues>(EMPTY_ADD_SPEAKER_FORM)
  const [known, setKnown] = useState<KnownSpeaker | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  const email = values.email.trim().toLowerCase()
  // The confirmation belongs to ONE address. Retyping the email after being told who owns it
  // has to put the button back to Add Speaker, or the second press would confirm an update
  // the organizer was never shown.
  // Held as the value rather than as a boolean beside it, so every reader of it is looking at
  // the person the confirmation is actually about.
  const confirmed = known !== undefined && known.email === email ? known : undefined

  function reset(): void {
    setValues(EMPTY_ADD_SPEAKER_FORM)
    setKnown(undefined)
    setProblem(undefined)
  }

  function close(): void {
    reset()
    setOpen(false)
  }

  function submit(): void {
    setProblem(undefined)
    startTransition(async () => {
      const result = await addSpeakerAction({
        eventId,
        email: values.email,
        name: values.name,
        company: values.company,
        tagline: values.tagline,
        bio: textToBioHtml(values.bioText),
        // Absent until the menu was used. See the header.
        ...(values.statusTouched ? { status: values.status } : {}),
        ...(confirmed === undefined ? {} : { confirmUpdate: true }),
      })
      if (!result.ok) {
        // On the sheet as well as in a toast. The sheet stays open on a refusal, and a faded
        // toast leaves a full form and a button that looks like it did nothing.
        setProblem(result.message)
        toast.error(result.message)
        return
      }

      if (result.outcome === 'exists') {
        // Nothing was written. The sheet stays open, names the person, and shows what they
        // currently hold so the organizer can see what an update would be doing. The select
        // is moved to their real status and marked untouched again, so leaving it alone
        // leaves the record alone.
        setKnown({ name: result.name, status: result.status, email })
        setValues((current) => ({ ...current, status: result.status, statusTouched: false }))
        return
      }

      toast.success(
        result.outcome === 'created' ? `Created ${result.name}` : `Updated ${result.name}`,
      )
      close()
      onAdded()
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      {/* `data-icon="inline-start"` trips the Button's own optical padding
          (`has-data-[icon=inline-start]:pl-1.5` at `size="sm"`), so the leading icon sits
          closer to the edge than the trailing text and the label reads centred. */}
      {/* `hit-area-y`: 28px tall in a toolbar whose controls sit at `gap-2`, so the miss is
          vertical and the fix must not grow sideways into its neighbours. */}
      <Button variant="outline" size="sm" className="hit-area-y" onClick={() => setOpen(true)}>
        <UserPlusIcon data-icon="inline-start" />
        Add Speaker
      </Button>
      {/* `overflow-y-auto` on the panel itself, since the fields here are direct children
          rather than one body element to make scrollable. Without it a short viewport puts
          ADD SPEAKER below the fold with no way to reach it, which is what happened to the
          edit sheet. See SpeakerEditSheet.tsx. */}
      <SheetContent className="flex flex-col gap-4 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Speaker</SheetTitle>
          <SheetDescription>
            Adding an address already on the roster updates that person rather than making a second
            record. You are asked first.
          </SheetDescription>
        </SheetHeader>

        {confirmed === undefined ? null : (
          <Alert>
            <AlertTitle className="text-balance">{confirmed.name} is already a speaker</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <span>
                {email} belongs to {confirmed.name}, currently{' '}
                {speakerStatusLabel(confirmed.status)}. Nothing has been written yet.
              </span>
              <span>
                Update {confirmed.name} to add them to this event and apply the fields you filled
                in. Anything left blank keeps whatever the record already holds.
              </span>
            </AlertDescription>
          </Alert>
        )}

        <AddSpeakerFields
          values={values}
          known={confirmed}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        />

        <SheetFooter className="flex-col items-stretch gap-3">
          {problem === undefined ? null : (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          <div className="flex flex-row justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            {/* `plain-label` ONLY on the confirm press, because that is the only one of the
                four labels carrying somebody's name: `Update Ada Okafor` rendered as
                UPDATE ADA OKAFOR in 11px mono, which is the machine-label treatment applied
                to a person. `Add Speaker` and the two pending labels are commands and keep
                it. */}
            <Button
              className={confirmed === undefined ? undefined : 'plain-label'}
              disabled={pending || email === ''}
              onClick={submit}
            >
              {buttonLabel(pending, confirmed)}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Four labels off two facts, and the naming is the feature: a button that reads `Add Speaker`
 * for a press that is going to edit an existing record is the whole defect this sheet was
 * fixed for.
 */
function buttonLabel(pending: boolean, confirmed: KnownSpeaker | undefined): string {
  if (confirmed === undefined) return pending ? 'Adding...' : 'Add Speaker'
  return pending ? 'Updating...' : `Update ${confirmed.name}`
}
