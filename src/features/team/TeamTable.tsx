'use client'

// The Event Team table: one row per membership, with the role select and the Remove action.
//
// PRESENTATION IS AUTHORED, NOT TRANSCRIBED. There is no screenshot of this surface anywhere
// in `sessionboard-refs/`, so there is no parity checklist for it and none was invented. The
// column set is BUILD_SPEC 5.0b verbatim ("name, email, role, added date"); the STRUCTURE is
// borrowed from the captured admin lists next door, which is the closest thing to evidence
// available: `Table` primitives as in `features/dashboard/HomeLists.tsx`, and the
// rename-in-place plus `AlertDialog` removal of `features/settings/LookupList.tsx`, which is
// the other real CRUD-over-a-small-table surface in the app.
//
// Split from TeamPanel.tsx so both stay well under the 300 line limit: this file owns the
// rows, the panel owns the list state and the add form.
//
// Removal goes through `AlertDialog` and never `confirm()`, which is banned, and the copy says
// what it costs, because revoking a role takes effect on that person's very next request.

import { SendIcon, TrashIcon, UserIcon } from 'lucide-react'
import { useState } from 'react'

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { EventRole } from '@/constants/status'
import { InviteLinkButton } from '@/features/team/InviteLinkButton'
import { formatAddedAt, TEAM_ROLE_LABELS, type TeamMember } from '@/features/team/members'

/** The `items` prop `Select` needs, or the closed trigger shows the raw stored value. */
const ROLE_ITEMS = [...TEAM_ROLE_LABELS].map(([value, label]) => ({ value, label }))

export type TeamTableProps = {
  eventId: string
  members: readonly TeamMember[]
  disabled: boolean
  onRoleChange: (membershipId: string, role: EventRole) => void
  onResendInvite: (membershipId: string) => void
  onRemove: (membershipId: string) => void
}

export function TeamTable({
  eventId,
  members,
  disabled,
  onRoleChange,
  onResendInvite,
  onRemove,
}: TeamTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead className="w-40">Role</TableHead>
          <TableHead className="w-32">Added</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TeamRow
            key={member.membershipId}
            eventId={eventId}
            member={member}
            disabled={disabled}
            onRoleChange={onRoleChange}
            onResendInvite={onResendInvite}
            onRemove={onRemove}
          />
        ))}
      </TableBody>
    </Table>
  )
}

function TeamRow({
  eventId,
  member,
  disabled,
  onRoleChange,
  onResendInvite,
  onRemove,
}: {
  eventId: string
  member: TeamMember
  disabled: boolean
} & Pick<TeamTableProps, 'onRoleChange' | 'onResendInvite' | 'onRemove'>) {
  // Controlled, so confirming closes the dialog: `AlertDialogAction` is a plain Button and
  // does not dismiss on its own.
  const [confirming, setConfirming] = useState(false)
  // Blank when the AdminUsers row has been deleted. `teamRows` keeps the membership so it can
  // be revoked from here, and naming it plainly beats an empty cell that reads as a bug.
  const known = member.email !== ''
  const name = member.name.trim()

  return (
    <TableRow>
      <TableCell className="font-medium">
        {name === '' ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <UserIcon className="size-3.5" />
            {known ? 'No name yet' : 'Deleted account'}
          </span>
        ) : (
          name
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{known ? member.email : '-'}</TableCell>
      <TableCell>
        <Select
          value={member.role}
          items={ROLE_ITEMS}
          disabled={disabled}
          onValueChange={(next: string | null) => {
            if (next !== null && next !== member.role)
              onRoleChange(member.membershipId, asRole(next))
          }}
        >
          <SelectTrigger aria-label="Role" className="w-full">
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
      </TableCell>
      <TableCell className="text-muted-foreground">{formatAddedAt(member.addedAt)}</TableCell>
      <TableCell className="flex items-center justify-end gap-0.5">
        {/* Adding somebody sends the sign-in link once and reports whether it went. Without
            a way to send it AGAIN, an organizer whose invite failed had no route to a
            working credential short of removing the person and adding them back. Hidden for
            a deleted account, which has no address to send to. */}
        {known ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Resend invite"
                  disabled={disabled}
                  // `hit-area-y` and not `hit-area`: send, link and trash are 32px wide at
                  // `gap-0.5`, so their horizontal pitch is 34 and a 40px-wide area on each
                  // would cross its neighbour. Vertically the row pitch is 49, so 40 clears.
                  className="hit-area-y"
                  onClick={() => onResendInvite(member.membershipId)}
                >
                  <SendIcon />
                </Button>
              }
            />
            <TooltipContent>Resend invite</TooltipContent>
          </Tooltip>
        ) : null}

        {/* And the link itself, for the case a mailbox cannot answer: a committee being set
            up in the room, a handover, or an organizer checking that the reviewer surface
            works at all. `invite-link.ts` refuses for anybody who is on a second event. */}
        {known ? (
          <InviteLinkButton
            eventId={eventId}
            membershipId={member.membershipId}
            disabled={disabled}
          />
        ) : null}

        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove"
                disabled={disabled}
                // Vertical only, for the reason the send button above gives: 34px of
                // horizontal pitch across the trio.
                className="hit-area-y"
              >
                <TrashIcon />
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              {/* `text-balance`: the title carries an address, so its length is the
                  member's and not the copy's, and a long one wrapped to leave `team?`
                  alone on the second line. */}
              <AlertDialogTitle className="text-balance">
                Remove {known ? member.email : 'this member'} from the team?
              </AlertDialogTitle>
              <AlertDialogDescription>
                They lose access to this event on their next request. Their account, and anything
                they have already reviewed or written, is kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel render={<Button variant="outline" />}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                render={
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setConfirming(false)
                      onRemove(member.membershipId)
                    }}
                  />
                }
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  )
}

/**
 * The `Select` hands back a plain string. Narrowed here rather than cast, so a value that is
 * somehow not a role falls back to `reviewer` in the UI and is refused by the action anyway
 * (`assertRole` in team-write.ts is the authority).
 */
function asRole(value: string): EventRole {
  return value === 'admin' ? 'admin' : 'reviewer'
}
