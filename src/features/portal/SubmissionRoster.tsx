// The participant roster on a submission detail page (BUILD_SPEC 5.2: "the participant
// roster from `SubmissionParticipants` with each person's role and a Primary marker").
//
// A list of avatars rather than a table: the roster is one to five people with two facts
// each, and `Table` is for the admin's dense sortable lists.
//
// EDITABLE now, where the edit mode allows it. It was read-only, and ABS-11 named the cost:
// "the portal's edit view of an existing submission has no add/remove participant control,
// so a co-author can only be attached while filling the public wizard." A cast decided once
// in a five-step wizard and frozen forever is not how a co-authored session gets written.
//
// This stays a server component and the two controls are client children, which is why they
// live in ./RosterControls.tsx: the list renders from data the page already has and needs no
// interactivity of its own.

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  AddParticipantDialog,
  RemoveParticipantButton,
  type RoleOption,
} from '@/features/portal/RosterControls'
import type { RosterEntry } from '@/features/portal/roster'

export type SubmissionRosterProps = {
  roster: readonly RosterEntry[]
  /**
   * Present only where the cast may be changed. ONE optional prop rather than a `canEdit`
   * flag beside the values it needs, so "no controls" is a state that cannot be half
   * described, and so the organizer's read-only panel (`review/SubmissionDetailPanel.tsx`,
   * which renders this same list) keeps working by passing nothing.
   *
   * Presentation only: the caller derives it from `rosterEditable`, and the actions
   * re-derive that from the record they load themselves. A closed form or a decided
   * submission arrives here as absent and the page reads exactly as it did before, which is
   * what keeps CFP-16 passing.
   */
  edit?: {
    /** `SESS-<n>`, the handle both actions address the submission by. */
    code: string
    /** The roles this form offers, from `assignableRoles`. Empty hides the Add control. */
    roles: readonly RoleOption[]
  }
}

export function SubmissionRoster({ roster, edit }: SubmissionRosterProps) {
  return (
    <div className="flex flex-col gap-3">
      {roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">No participants on this submission.</p>
      ) : (
        <ul className="space-y-2">
          {roster.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3">
              <Avatar size="sm">
                {entry.avatarUrl === undefined ? null : (
                  <AvatarImage src={entry.avatarUrl} alt="" />
                )}
                <AvatarFallback>{entry.initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {entry.name}
                  {entry.isViewer ? <span className="text-muted-foreground"> (you)</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{entry.email}</p>
              </div>
              {entry.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
              <Badge variant="outline">{entry.roleLabel}</Badge>
              {/* Never on the primary. That is the submitter, and a submission with nobody
                  on it is one the reminder sweep drops (`draftsOf`) and a decision cannot
                  notify (`SUB_NO_RECIPIENTS`). `removalProblems` refuses it server-side as
                  well; this is why there is no button to press in the first place. */}
              {edit !== undefined && !entry.isPrimary ? (
                <RemoveParticipantButton
                  code={edit.code}
                  participantId={entry.id}
                  name={entry.name}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {edit === undefined ? null : <AddParticipantDialog code={edit.code} roles={edit.roles} />}
    </div>
  )
}
