'use client'

// The organizer's editable Participants block on a submission detail page.
//
// It replaces a read-only list. The gap it closes was measured rather than guessed: with
// Participants read-only and EDIT opening Title and Abstract only, a session linked to the
// wrong `Priya Raman` record could not be repointed at all, and the organizer resorted to
// filing a duplicate session (SESS-33) to get the right speaker attached. See
// ./roster-admin.ts for the writes and why an organizer is not held to the speaker's
// close-date lock.
//
// A client component, unlike the portal's `SubmissionRoster`, because every row now carries
// controls. The DATA is still built on the server (`adminRosterRows`) and arrives as plain
// values, so nothing here reads Airtable and the rules live behind the actions.
//
// Change speaker is offered on EVERY row including the primary, and Remove on none of the
// primaries. That pairing is the fix: `removalProblems` refuses to remove a submitter
// (`Submissions.submitter` is a required link and it is who the decision email goes to), so
// a primary pointed at the wrong person is only correctable by repointing it.

import { MoreHorizontalIcon, UserPlusIcon, UsersIcon } from 'lucide-react'
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
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AddParticipantDialog,
  ChangeSpeakerDialog,
  type RoleOption,
  type RosterTarget,
} from '@/features/submissions/ParticipantDialogs'
import { removeSubmissionParticipantAction } from '@/features/submissions/roster-actions'
import type { AdminRosterRow, RosterCandidate } from '@/features/submissions/roster-admin-view'
import { useRosterAction } from '@/features/submissions/use-roster-action'

export function SubmissionParticipantsPanel({
  eventId,
  submissionId,
  rows,
  candidates,
  roles,
  canEdit,
}: {
  eventId: string
  submissionId: string
  rows: readonly AdminRosterRow[]
  /** Everyone on the event, for the Change speaker picker. */
  candidates: readonly RosterCandidate[]
  roles: readonly RoleOption[]
  /**
   * Whether the viewer may write. A reviewer reaches this panel through the same detail
   * page and gets the list it always was. Presentation only: every action re-derives
   * `admin` on the event for itself, because a Server Action is reachable by POST with no
   * page ever rendering.
   */
  canEdit: boolean
}) {
  const [adding, setAdding] = useState(false)
  const target: RosterTarget = { eventId, submissionId }

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No participants on this session.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3">
              <Avatar size="sm">
                {row.headshotUrl === undefined ? null : (
                  <AvatarImage src={row.headshotUrl} alt="" />
                )}
                <AvatarFallback>{row.initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <p className="truncate text-xs text-muted-foreground">{row.email}</p>
              </div>
              {row.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
              <Badge variant="outline">{row.roleLabel}</Badge>
              {canEdit ? (
                <RowActions
                  target={target}
                  row={row}
                  // Everyone already on the session is dropped, because pointing a row at
                  // somebody who is on it twice is what `reassignParticipantOnSubmission`
                  // refuses: two rows for one person make the roster count, the role rules
                  // and `ownSubmissions` all wrong.
                  candidates={candidates.filter(
                    (candidate) => !rows.some((entry) => entry.speakerId === candidate.id),
                  )}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <>
          <Button
            variant="outline"
            size="sm"
            // `hit-area-y`: 28px tall, and `self-start` keeps it under the avatars rather
            // than under the row menus, so the 6px it gains upward meets nothing.
            className="self-start hit-area-y"
            onClick={() => setAdding(true)}
          >
            {/* Optical padding, per the Button's own `has-data-[icon=inline-start]` rule:
                without the attribute the icon is padded as if it were the first letter. */}
            <UserPlusIcon data-icon="inline-start" />
            Add participant
          </Button>
          <AddParticipantDialog
            target={target}
            roles={roles}
            open={adding}
            onOpenChange={setAdding}
          />
        </>
      ) : null}
    </div>
  )
}

function RowActions({
  target,
  row,
  candidates,
}: {
  target: RosterTarget
  row: AdminRosterRow
  candidates: readonly RosterCandidate[]
}) {
  // Both held here rather than opened from a trigger inside the menu, for the reason
  // `agenda/list/AgendaRowActions.tsx` gives: a trigger nested in a menu item has the
  // menu's dismissal fighting the dialog's focus trap.
  const [changing, setChanging] = useState(false)
  const [removing, setRemoving] = useState(false)
  const { pending, run } = useRosterAction()

  function remove(): void {
    const formData = new FormData()
    formData.set('eventId', target.eventId)
    formData.set('submissionId', target.submissionId)
    formData.set('participantId', row.id)
    run(removeSubmissionParticipantAction, formData, () => {
      setRemoving(false)
    })
  }

  return (
    <>
      <DropdownMenu>
        {/* 36px and not 40: a participant row is as short as the 28px button itself when the
            speaker has no email on file, and the rows sit at `space-y-2`, so the pitch to the
            same menu one row down is 28 + 8 = 36. */}
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" disabled={pending} className="hit-area-[36px]" />
          }
        >
          <MoreHorizontalIcon />
          <span className="sr-only">{`Participant actions for ${row.name}`}</span>
        </DropdownMenuTrigger>
        {/* Widened, because the default sizes to the widest item and the widest item here
            is the two-line note below: without it "Change speaker" wrapped onto two lines. */}
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => setChanging(true)}>
            <UsersIcon />
            Change speaker
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Disabled rather than hidden on the primary, with the reason on the row below,
              because "there is no Remove here" was itself the confusing half of the defect:
              an organizer who cannot remove the wrong person and is told nothing concludes
              the panel is broken rather than that Change speaker is the control they want. */}
          <DropdownMenuItem disabled={row.isPrimary} onClick={() => setRemoving(true)}>
            Remove from session
          </DropdownMenuItem>
          {row.isPrimary ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              The submitter cannot be removed. Change speaker instead.
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {changing ? (
        <ChangeSpeakerDialog
          target={target}
          row={row}
          candidates={candidates}
          open={changing}
          onOpenChange={setChanging}
        />
      ) : null}

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Remove ${row.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              They stay on any other session they are part of, and their speaker profile is not
              deleted. You can add them back with the same email address.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={remove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
