'use client'

// The one control on `/admin/{eventId}/profile`: the acting user's display name.
//
// PRESENTATION IS AUTHORED, NOT TRANSCRIBED. No screenshot of a Sessionboard account page
// exists in `sessionboard-refs/`, so there is no parity checklist for this and none was
// invented. The shape is `features/settings/EventDetailsForm.tsx` next door, reduced to the
// single field this page actually owns: label above input, Save at the bottom, `Saved
// successfully` on the way out.
//
// The address is shown and NOT editable, which is the honest rendering of what the product
// can do. An email change would have to move the row every magic link, every membership and
// every review resolves through, and nothing in this build can do that; a disabled input
// that looks editable would promise otherwise. It is rendered as text for that reason
// (a disabled `Input` is a control that has been switched off, which reads as "not yet").

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkProfileName, PROFILE_NAME_MAX_LENGTH } from '@/features/team/profile'
import { saveProfileNameAction } from '@/features/team/profile-actions'

export type ProfileFormProps = {
  /** The stored name, blank for a row that has never had one. */
  initialName: string
  /** Blank only if the row could not be resolved, which the page handles above. */
  email: string
}

export function ProfileForm({ initialName, email }: ProfileFormProps) {
  const [name, setName] = useState(initialName)
  const [saved, setSaved] = useState(initialName)
  /** The last refusal, kept on screen rather than only toasted. As in `TeamPanel`. */
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  function save(): void {
    // Run locally first so the limit reports without a round trip. The action re-runs it:
    // this copy is a convenience, that one is the protection.
    const found = checkProfileName(name)
    setProblem(found?.message)
    if (found !== undefined) {
      toast.error(found.message)
      return
    }

    startTransition(async () => {
      const result = await saveProfileNameAction({ name })
      if (!result.ok) {
        setProblem(result.message)
        toast.error(result.message)
        return
      }
      // Adopt the STORED value, which is trimmed and has its whitespace collapsed, so the
      // field stops showing something the base does not hold.
      setName(result.name)
      setSaved(result.name)
      toast.success('Saved successfully')
    })
  }

  const dirty = name !== saved

  return (
    <div className="flex max-w-xl min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-name">Full name</Label>
        <Input
          id="profile-name"
          value={name}
          placeholder="Your name"
          autoComplete="name"
          maxLength={PROFILE_NAME_MAX_LENGTH}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <p className="text-pretty text-xs text-muted-foreground">
          Shown on the Event Team table, in the reviewer committee picker, and on your own avatar.
          Leave it empty to go back to being listed by email address.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-email">Email address</Label>
        {/* Text, not a disabled field. See the header. */}
        <p id="profile-email" className="text-sm">
          {email}
        </p>
        <p className="text-pretty text-xs text-muted-foreground">
          This is the address your sign-in link is sent to. It cannot be changed here.
        </p>
      </div>

      {problem === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}

      <div>
        <Button disabled={pending || !dirty} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  )
}
