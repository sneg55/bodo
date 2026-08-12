'use client'

// The two roster controls: add somebody, take somebody off.
//
// ABS-11: "the portal's edit view of an existing submission has no add/remove participant
// control, so a co-author can only be attached while filling the public wizard." Both
// controls re-check ownership and the edit mode in the action rather than trusting that
// this component only rendered for somebody allowed to press them.
//
// `router.refresh()` after each one, which every sibling that mutates portal data does
// (`TaskCompletion.tsx` documents why): the action expires the SERVER cache tags, and the
// client router still holds the RSC payload it already rendered. Without the refresh the
// roster on screen is the roster from before the press.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ParticipantRole } from '@/constants/status'
import type { ActionResult } from '@/features/portal/roster-actions'
import { addParticipantAction, removeParticipantAction } from '@/features/portal/roster-actions'

export type RoleOption = { role: ParticipantRole; label: string }

/** Runs an action, reports it, and re-renders the roster the server now holds. */
function useRosterAction() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function run(
    action: (formData: FormData) => Promise<ActionResult>,
    formData: FormData,
    onDone?: () => void,
  ): void {
    startTransition(async () => {
      const result = await action(formData)
      if (result.ok) {
        toast.success(result.message)
        onDone?.()
        router.refresh()
        return
      }
      toast.error(result.message)
    })
  }

  return { pending, run }
}

export function AddParticipantDialog({
  code,
  roles,
}: {
  code: string
  roles: readonly RoleOption[]
}) {
  const { pending, run } = useRosterAction()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState<string | null>(roles.at(0)?.role ?? null)

  // No roles means the organizer disabled every one on this form, so there is no role a
  // new person could hold. A control that can only refuse is worse than no control.
  if (roles.length === 0) return null

  function submit(): void {
    const formData = new FormData()
    formData.set('code', code)
    formData.set('email', email)
    formData.set('firstName', firstName)
    formData.set('lastName', lastName)
    formData.set('role', role ?? '')
    run(addParticipantAction, formData, () => {
      setOpen(false)
      setEmail('')
      setFirstName('')
      setLastName('')
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* 28px, 12px under the roster list across its `gap-3`. The last row's `Remove` sits
          4px inside that row, so there are 16px between the two controls and 12 of it is
          taken by the two bands together. */}
      <DialogTrigger render={<Button variant="outline" size="sm" className="hit-area-y" />}>
        Add participant
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a participant</DialogTitle>
          {/* `DialogDescription` carries no wrapping rule of its own, unlike
              `AlertDialogDescription` and `AlertDescription`, which both ship `text-balance
              md:text-pretty`. So this paragraph asks for it, and the Remove dialog below
              does not need to. */}
          <DialogDescription>
            They are added by email address. If they already have a speaker profile it is reused,
            and they can sign in with that address to see this session.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field id="participant-email" label="Email">
            <Input
              id="participant-email"
              type="email"
              value={email}
              placeholder="name@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="participant-first" label="First name">
              <Input
                id="participant-first"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </Field>
            <Field id="participant-last" label="Last name">
              <Input
                id="participant-last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </Field>
          </div>
          <Field id="participant-role" label="Role">
            <Select
              items={Object.fromEntries(roles.map((option) => [option.role, option.label]))}
              value={role}
              onValueChange={(next: string | null) => setRole(next)}
            >
              <SelectTrigger id="participant-role" className="hit-area-y w-full">
                <SelectValue placeholder="Select role..." />
              </SelectTrigger>
              <SelectContent>
                {roles.map((option) => (
                  <SelectItem key={option.role} value={option.role}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <DialogFooter>
          {/* 32px, alone in a footer with 16px of its own padding above it. */}
          <Button className="hit-area-y" disabled={pending} onClick={submit}>
            {pending ? 'Adding...' : 'Add participant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RemoveParticipantButton({
  code,
  participantId,
  name,
}: {
  code: string
  participantId: string
  name: string
}) {
  const { pending, run } = useRosterAction()

  function remove(): void {
    const formData = new FormData()
    formData.set('code', code)
    formData.set('participantId', participantId)
    run(removeParticipantAction, formData)
  }

  return (
    <AlertDialog>
      {/* 28px, centred on a 36px roster row on a `space-y-2` list, so the next row's Remove
          is 44px away and two bands take 12 of it. */}
      <AlertDialogTrigger
        render={<Button variant="ghost" size="sm" className="hit-area-y" disabled={pending} />}
      >
        Remove
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Remove ${name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            They stay on any other session they are part of, and their speaker profile is not
            deleted. You can add them back with the same email address.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* 32px each. The footer stacks them `flex-col-reverse gap-2` under `sm`, which is
              a 40px pitch, so the two bands meet exactly and neither crosses the other. */}
          <AlertDialogCancel className="hit-area-y">Cancel</AlertDialogCancel>
          <AlertDialogAction className="hit-area-y" onClick={remove}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
