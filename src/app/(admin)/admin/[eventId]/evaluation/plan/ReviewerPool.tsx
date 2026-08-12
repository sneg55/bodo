'use client'

// A round's reviewer pool: who is eligible to be assigned work in this round.
//
// EMPTY MEANS EVERYONE, and the empty state says so rather than reading as a mistake.
// That is not a UI convenience: every round that existed before this column had it
// empty, so reading empty as "nobody" would have emptied every committee on the day the
// migration ran. `Round.reviewerIds` carries the same note.
//
// Selecting nobody and selecting everybody are therefore the same stored value, which is
// correct: a pool naming all six people on the event constrains nothing.

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { EventReviewer } from '@/features/review/review-reads'
import { reviewerDisplayName } from '@/features/review/reviewer-progress'

export function ReviewerPool({
  roundId,
  reviewers,
  selected,
  onChange,
}: {
  roundId: string
  reviewers: readonly EventReviewer[]
  selected: readonly string[]
  onChange: (next: readonly string[]) => void
}) {
  const chosen = new Set(selected)

  const toggle = (id: string) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Reviewer pool</p>
        {chosen.size === 0 ? (
          <Badge variant="secondary">Everyone on this event</Badge>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Open to everyone
          </Button>
        )}
      </div>

      {reviewers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody has a role on this event yet. Add reviewers under Team.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 rounded-md border p-3">
          {reviewers.map((person) => (
            <div key={person.id} className="flex items-center gap-2">
              <Checkbox
                id={`pool-${roundId}-${person.id}`}
                checked={chosen.has(person.id)}
                onCheckedChange={() => toggle(person.id)}
              />
              {/* Never the raw name: a member added by email and not yet signed in has
                  none, and the label is the checkbox's whole hit target. */}
              <Label htmlFor={`pool-${roundId}-${person.id}`} className="font-normal">
                {reviewerDisplayName(person)}
              </Label>
              <Badge variant="secondary">{person.role}</Badge>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        A reviewer outside the pool cannot be assigned work in this round and does not see it in
        their queue.
      </p>
    </div>
  )
}
