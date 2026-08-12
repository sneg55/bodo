'use client'

// Committee assignment: pick submissions, pick a committee or individual reviewers, assign.
//
// BUILD_SPEC 5.4: "Committee assignment is the bulk path, individual assignment is the
// escape hatch." Both write `ReviewAssignments`, so the reviewer queue has one shape to
// read, and the action materialises one row per (submission, reviewer) rather than a
// team-level record the queue would have to join through (section 3).

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { assignCommitteeAction, distributeAssignmentsAction } from '@/features/review/actions'
import { committeeEligibility } from '@/features/review/committee-eligibility'
import type { AssignableSubmission } from '@/features/review/evaluation-view'
import type { EventReviewer, ReviewTeamWithMembers } from '@/features/review/review-reads'
import { reviewerDisplayName } from '@/features/review/reviewer-progress'

import { SubmissionPicker } from './SubmissionPicker'

const INDIVIDUAL = 'individual'

export type CommitteePanelProps = {
  eventId: string
  roundId: string
  roundName: string
  teams: readonly ReviewTeamWithMembers[]
  reviewers: readonly EventReviewer[]
  submissions: readonly AssignableSubmission[]
}

export function CommitteePanel({
  eventId,
  roundId,
  roundName,
  teams,
  reviewers,
  submissions,
}: CommitteePanelProps) {
  const [teamId, setTeamId] = useState<string>(teams.at(0)?.id ?? INDIVIDUAL)
  const [reviewerIds, setReviewerIds] = useState<readonly string[]>([])
  const [selected, setSelected] = useState<readonly string[]>([])
  const [perSubmission, setPerSubmission] = useState('2')
  const [pending, startTransition] = useTransition()

  // Who this selection would actually reach. `reviewers` is already the ROUND's pool
  // (`loadEvaluationView` pares it down), so the intersection is the same filter
  // `assignCommitteeAction` applies server side, made before the press instead of after it.
  const team = teams.find((entry) => entry.id === teamId)
  const eligibility = committeeEligibility({
    picked: teamId === INDIVIDUAL ? reviewerIds : (team?.memberIds ?? []),
    pool: reviewers,
    committeeName: team?.name,
  })

  // value -> label for the select below. Built from the same array that renders the options,
  // so a label can never disagree with the list it came from.
  const committeeItems: Record<string, string> = {
    ...Object.fromEntries(teams.map((entry) => [entry.id, entry.name])),
    [INDIVIDUAL]: 'Pick reviewers individually',
  }

  const toggleReviewer = (id: string, checked: boolean) => {
    setReviewerIds(
      checked
        ? [...reviewerIds.filter((entry) => entry !== id), id]
        : reviewerIds.filter((entry) => entry !== id),
    )
  }

  const distribute = () => {
    startTransition(async () => {
      const result = await distributeAssignmentsAction({
        eventId,
        roundId,
        submissionIds: selected,
        reviewersPerSubmission: Number(perSubmission),
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // The shortfall is a WARNING and not a success line. An organizer whose cap left six
      // abstracts unread has to be told in the same breath as the 34 that worked, because
      // the alternative is finding out from the progress dashboard in three weeks.
      const spread = `${String(result.created)} assigned across ${String(result.reviewers)} reviewers.`
      if (result.short > 0) {
        toast.warning(
          `${spread} ${String(result.short)} could not be filled: raise the cap or add reviewers.`,
        )
      } else {
        toast.success(spread)
      }
      setSelected([])
    })
  }

  const assign = () => {
    startTransition(async () => {
      const result = await assignCommitteeAction({
        eventId,
        roundId,
        submissionIds: selected,
        teamId: teamId === INDIVIDUAL ? undefined : teamId,
        reviewerIds: teamId === INDIVIDUAL ? reviewerIds : undefined,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(
        `${result.created} assigned, ${result.skipped} already assigned. ${result.entered} entered ${roundName}.`,
      )
      setSelected([])
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Committee</Label>
        <Select
          // `items` is not optional decoration. Base UI's `Select.Value` prints the raw
          // VALUE unless the root can map it to a label, so the closed trigger read
          // `fixTeam1` while the open list read `Program Committee`. Seen on the running
          // app. Passing the map here fixes the trigger and the placeholder together, and
          // keeps the labels in one place rather than duplicating them in a render
          // function, which is how `AddTaskSheet` had to solve the same bug.
          items={committeeItems}
          value={teamId}
          onValueChange={(next: string | null) => {
            if (next !== null) setTeamId(next)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
            <SelectItem value={INDIVIDUAL}>Pick reviewers individually</SelectItem>
          </SelectContent>
        </Select>
        {/* Said here, under the control that caused it, and before the press. The action
            refuses this selection anyway, but a refusal arriving as a toast a round trip
            later is indistinguishable from a button that did nothing, which is exactly how
            it read: two submissions selected, ASSIGN pressed, progress still 0 of 0. */}
        {eligibility.warning === undefined ? null : (
          <p className="text-sm text-destructive">{eligibility.warning}</p>
        )}
      </div>

      {teamId === INDIVIDUAL ? (
        <div className="flex flex-col gap-1.5">
          <Label>Reviewers</Label>
          {reviewers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody on this event yet. Add people under Event Team.
            </p>
          ) : null}
          {reviewers.map((reviewer) => (
            <Label key={reviewer.id} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={reviewerIds.includes(reviewer.id)}
                onCheckedChange={(checked) => toggleReviewer(reviewer.id, checked)}
              />
              {/* This picker already fell back to the email; it is the shared helper now so
                  the pool, the progress list and this one cannot drift. */}
              <span className="truncate">{reviewerDisplayName(reviewer)}</span>
              <span className="text-xs text-muted-foreground">{reviewer.role}</span>
            </Label>
          ))}
        </div>
      ) : null}

      <Separator />

      <SubmissionPicker submissions={submissions} selected={selected} onSelected={setSelected} />

      <div className="flex flex-wrap items-end gap-2">
        {/* Disabled on an empty eligible set as well as an empty selection: the press would
            write nothing either way, and the sentence under the Committee select says which
            of the two it is. */}
        <Button
          disabled={pending || selected.length === 0 || eligibility.eligible.length === 0}
          onClick={assign}
        >
          Assign to {roundName}
        </Button>

        {/* The other shape of the same operation. `Assign` gives everyone picked all of
            the submissions picked, which is what a small programme committee wants;
            `Distribute evenly` splits them, which is the only one of the two that scales
            past a couple of dozen abstracts. The pool it spreads across is the ROUND's,
            resolved server side, so this needs no committee selection above it. */}
        <div className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="per-submission">Reviewers each</Label>
            <Input
              id="per-submission"
              type="number"
              min={1}
              inputMode="numeric"
              className="w-20"
              value={perSubmission}
              onChange={(event) => setPerSubmission(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            disabled={pending || selected.length === 0}
            onClick={distribute}
          >
            Distribute evenly
          </Button>
        </div>
      </div>
    </div>
  )
}
