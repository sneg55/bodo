'use client'

// One round: its name, its dates, whether it is anonymised, who is in its pool, and its
// scorecard.
//
// Local state, saved explicitly, rather than the autosave the score sheet uses. The two
// are genuinely different: a reviewer edits one field of their own review and wants it
// safe the moment they look away, while an organizer restructuring a rubric is midway
// through an incoherent state for as long as it takes to add three criteria. Autosaving
// that would re-weight every review already filed, several times, on the way to the
// shape they meant.
//
// The counts in the header are the warning. A rubric edited after reviews have landed
// re-weights scores that were filed under the old one, and once either count is above
// zero the round can no longer be deleted, which the button says rather than discovers.

import { TrashIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { DateTimeField } from '@/components/primitives/DateTimeField'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { deleteRoundAction, saveRoundAction } from '@/features/review/plan-actions'
import type { PlanRoundView } from '@/features/review/plan-view'
import type { EventReviewer } from '@/features/review/review-reads'
import type { Criterion } from '@/types/domain'

import { CriteriaEditor } from './CriteriaEditor'
import { ReviewerPool } from './ReviewerPool'

export function RoundCard({
  eventId,
  planId,
  round,
  reviewers,
  timeZone,
  onSaved,
}: {
  eventId: string
  planId: string
  round: PlanRoundView
  reviewers: readonly EventReviewer[]
  /** The event's zone. A round's dates belong to the conference, not to the browser. */
  timeZone: string
  onSaved: () => void
}) {
  const [name, setName] = useState(round.name)
  const [startsAt, setStartsAt] = useState(round.startsAt)
  const [endsAt, setEndsAt] = useState(round.endsAt)
  const [anonymous, setAnonymous] = useState(round.anonymous)
  const [reviewerIds, setReviewerIds] = useState<readonly string[]>(round.reviewerIds)
  // Held as the string the input posts, so an organizer clearing the box is distinct from
  // one typing 0. The action parses it; see `parseCap`.
  const [maxPerReviewer, setMaxPerReviewer] = useState(
    round.maxPerReviewer === undefined ? '' : String(round.maxPerReviewer),
  )
  const [criteria, setCriteria] = useState<readonly Criterion[]>(round.criteria)
  const [pending, startTransition] = useTransition()

  // Every review filed against this rubric, the AI pre-screen's included. The two counts are
  // reported separately in the header, because the committee's progress is a different fact
  // from the machine's, but a rubric edit re-scores both and a delete would destroy both.
  const filed = round.reviews + round.aiReviews
  const locked = filed > 0

  const save = () => {
    startTransition(async () => {
      const result = await saveRoundAction({
        eventId,
        planId,
        roundId: round.id,
        name,
        criteria,
        startsAt: startsAt ?? '',
        endsAt: endsAt ?? '',
        anonymous,
        reviewerIds,
        maxPerReviewer,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Saved successfully')
      onSaved()
    })
  }

  const remove = () => {
    startTransition(async () => {
      const result = await deleteRoundAction({ eventId, planId, roundId: round.id })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(`${round.name} deleted`)
      onSaved()
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex flex-wrap items-center gap-2">
          {round.name}
          <Badge variant="secondary" className="tabular-nums">
            {round.assignments} assigned
          </Badge>
          <Badge variant="secondary" className="tabular-nums">
            {round.reviews} reviewed
          </Badge>
          {/* Counted apart from the committee's, never inside it. Folded together, this
              header read `4 assigned / 6 reviewed`, which is arithmetically impossible and
              contradicted the Evaluation page's own `2/4` on the same round. */}
          {round.aiReviews === 0 ? null : (
            <Badge variant="outline" className="tabular-nums">
              {round.aiReviews} AI pre-screen
            </Badge>
          )}
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${round.name}`}
          disabled={pending || round.assignments > 0 || filed > 0}
          onClick={remove}
        >
          <TrashIcon />
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor={`name-${round.id}`}>Name</Label>
            <Input
              id={`name-${round.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`starts-${round.id}`}>Opens</Label>
            <DateTimeField
              id={`starts-${round.id}`}
              value={startsAt}
              timeZone={timeZone}
              onChange={setStartsAt}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`ends-${round.id}`}>Closes</Label>
            <DateTimeField
              id={`ends-${round.id}`}
              value={endsAt}
              timeZone={timeZone}
              onChange={setEndsAt}
            />
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-md border p-3">
          <Switch
            id={`anon-${round.id}`}
            checked={anonymous}
            onCheckedChange={(next: boolean) => setAnonymous(next)}
          />
          <div className="space-y-0.5">
            <Label htmlFor={`anon-${round.id}`}>Anonymised review</Label>
            <p className="text-sm text-muted-foreground">
              Reviewers on this round see the title and the abstract, and not who submitted it.
            </p>
          </div>
        </div>

        <ReviewerPool
          roundId={round.id}
          reviewers={reviewers}
          selected={reviewerIds}
          onChange={setReviewerIds}
        />

        <div className="space-y-1.5">
          <Label htmlFor={`cap-${round.id}`}>Max submissions per reviewer</Label>
          <Input
            id={`cap-${round.id}`}
            type="number"
            min={0}
            inputMode="numeric"
            className="w-40"
            placeholder="No limit"
            value={maxPerReviewer}
            onChange={(event) => setMaxPerReviewer(event.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            The ceiling Distribute evenly works to on the Evaluation page. Leave it empty for no
            limit. Assigning a committee by hand ignores it, so a chair can still overrule
            themselves for one submission.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Scorecard</p>
          {locked ? (
            <p className="text-sm text-muted-foreground">
              {filed} {filed === 1 ? 'review has' : 'reviews have'} been filed against this
              scorecard. Changing a weight or a range re-scores every one of them.
            </p>
          ) : null}
          <CriteriaEditor criteria={criteria} onChange={setCriteria} />
        </div>

        <div>
          <Button disabled={pending} onClick={save}>
            Save round
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
