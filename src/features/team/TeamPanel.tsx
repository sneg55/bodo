'use client'

// Event Team: the list state, and the `+ Add Member` form above it.
//
// PRESENTATION IS AUTHORED, NOT TRANSCRIBED. See the header of ./TeamTable.tsx: there is no
// screenshot of this surface, so the control inventory is BUILD_SPEC 5.0b ("`+ Add Member`
// taking an email plus a role... a role select per row... and a Remove action") and the shape
// is borrowed from `features/settings/LookupList.tsx`, which is the app's other real
// CRUD-over-a-small-table screen.
//
// The optimistic pattern is that file's too: the action returns the row it wrote, the list is
// patched from THAT rather than from what was typed, and a refusal only raises a toast, so a
// duplicate address or a last-admin lockout leaves the table exactly as the base has it.

import { PlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { EventRole } from '@/constants/status'
import { TEAM_ROLE_LABELS, type TeamMember } from '@/features/team/members'
import { TeamTable } from '@/features/team/TeamTable'
import {
  addTeamMemberAction,
  changeTeamRoleAction,
  removeTeamMemberAction,
  resendTeamInviteAction,
} from '@/features/team/team-actions'

/** The `items` prop `Select` needs, or the closed trigger shows the raw stored value. */
const ROLE_ITEMS = [...TEAM_ROLE_LABELS].map(([value, label]) => ({ value, label }))

export type TeamPanelProps = {
  eventId: string
  members: readonly TeamMember[]
}

export function TeamPanel({ eventId, members: initial }: TeamPanelProps) {
  const [members, setMembers] = useState<readonly TeamMember[]>(initial)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<EventRole>('reviewer')
  /** The last refusal from Add Member, kept on screen. See where it renders. */
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  function add(): void {
    setProblem(undefined)
    startTransition(async () => {
      const result = await addTeamMemberAction({ eventId, email, role })
      if (!result.ok) {
        setProblem(result.message)
        toast.error(result.message)
        return
      }
      setMembers((current) => [...current, result.member])
      setEmail('')
      // Said plainly rather than hidden: with no email provider configured the invite is only
      // logged (services/email/send.ts), and the organizer needs to know to tell them.
      toast.success(
        result.invited
          ? `Invite sent to ${result.member.email}`
          : `${result.member.email} was added, but the invite could not be sent`,
      )
    })
  }

  function resendInvite(membershipId: string): void {
    startTransition(async () => {
      const result = await resendTeamInviteAction({ eventId, membershipId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // The same honest distinction `add` draws: with no provider configured, or with a
      // provider that refuses the address, the link was only logged and the organizer has to
      // know that rather than assume it arrived.
      if (result.invited) {
        toast.success(`Invite sent to ${result.member.email}`)
      } else {
        toast.error(`The invite to ${result.member.email} could not be sent`)
      }
    })
  }

  function changeRole(membershipId: string, next: EventRole): void {
    startTransition(async () => {
      const result = await changeTeamRoleAction({ eventId, membershipId, role: next })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setMembers((current) =>
        current.map((member) =>
          member.membershipId === membershipId ? { ...member, role: result.member.role } : member,
        ),
      )
      toast.success('Saved successfully')
    })
  }

  function remove(membershipId: string): void {
    startTransition(async () => {
      const result = await removeTeamMemberAction({ eventId, membershipId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setMembers((current) =>
        current.filter((member) => member.membershipId !== result.membershipId),
      )
      toast.success('Saved successfully')
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-4">
        <div className="min-w-56 flex-1">
          <Label htmlFor="team-email" className="mb-1.5">
            Email address
          </Label>
          <Input
            id="team-email"
            type="email"
            value={email}
            placeholder="name@example.com"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setEmail(event.target.value)
            }}
          />
        </div>
        <div className="w-40">
          <Label htmlFor="team-role" className="mb-1.5">
            Role
          </Label>
          <Select
            value={role}
            items={ROLE_ITEMS}
            onValueChange={(next: string | null) => {
              if (next !== null) setRole(next === 'admin' ? 'admin' : 'reviewer')
            }}
          >
            <SelectTrigger id="team-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button disabled={pending || email.trim() === ''} onClick={add}>
          {/* Trips the Button's own optical padding for a leading icon. See
              DataTableToolbar.tsx, which documents the rule. */}
          <PlusIcon data-icon="inline-start" />
          Add Member
        </Button>

        {/* The refusal, said where the form is and left there.

            A toast was the only report of it, and a toast is the wrong instrument for this
            one: adding somebody who is already on the team is the most common way this
            fails, the round trip to Airtable is slow enough that the notice can arrive after
            attention has moved back to the field, and four seconds later there is nothing on
            the screen distinguishing "refused" from "nothing happened". The toast still
            fires; this is what is still there afterwards. */}
        {problem === undefined ? null : (
          <p role="alert" className="w-full text-sm text-destructive">
            {problem}
          </p>
        )}
      </div>

      {members.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-pretty text-sm text-muted-foreground">
          No team members yet. Add somebody by email address above.
        </p>
      ) : (
        <TeamTable
          eventId={eventId}
          members={members}
          disabled={pending}
          onRoleChange={changeRole}
          onResendInvite={resendInvite}
          onRemove={remove}
        />
      )}
    </div>
  )
}
