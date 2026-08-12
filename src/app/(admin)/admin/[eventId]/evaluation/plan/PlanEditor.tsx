'use client'

// The evaluation plan editor: the plan itself, and a card per round.
//
// This is what the run found missing rather than broken. A base could be seeded with a
// plan and two rounds, and nothing in the product could create, rename, re-order or
// configure one, so the empty state's "Create one" pointed at nothing and every rubric an
// organizer had was whatever the seed script happened to write.
//
// A plan's STATUS is on the header rather than buried in a settings panel, because it is
// the switch that decides which rounds reviewers see at all: `getActivePlan` returns the
// active plan, and a plan left in draft is invisible to the whole Evaluation surface.
// Making that a two-word dropdown next to the name is what stops it being a mystery.

import { PlusIcon, SlidersHorizontalIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { savePlanAction, saveRoundAction } from '@/features/review/plan-actions'
import type { PlanView } from '@/features/review/plan-view'

import { RoundCard } from './RoundCard'

const STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'closed', label: 'Closed' },
] as const

export function PlanEditor({
  eventId,
  view,
  timeZone,
}: {
  eventId: string
  view: PlanView
  timeZone: string
}) {
  const router = useRouter()
  // Hoisted out of the JSX so the narrowing survives into the round list below: reading
  // `view.plan?.id` inside a `.map` callback loses it, because the callback could in
  // principle run later.
  const plan = view.plan
  const [name, setName] = useState(plan?.name ?? 'Program review')
  const [status, setStatus] = useState<string>(plan?.status ?? 'active')
  const [pending, startTransition] = useTransition()

  const refresh = () => {
    router.refresh()
  }

  const savePlan = () => {
    startTransition(async () => {
      const result = await savePlanAction({ eventId, planId: plan?.id, name, status })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Saved successfully')
      refresh()
    })
  }

  const addRound = () => {
    const planId = plan?.id
    if (planId === undefined) return
    startTransition(async () => {
      const result = await saveRoundAction({
        eventId,
        planId,
        // A new round starts EMPTY rather than copying the previous one's rubric.
        // Copying looks helpful and is how a second round silently ends up scored on
        // the first round's criteria, which is the thing two rounds exist to avoid.
        name: `Round ${String(view.rounds.length + 1)}`,
        criteria: [],
        startsAt: '',
        endsAt: '',
        anonymous: false,
        reviewerIds: [],
        // No ceiling, matching the empty pool above: a new round restricts nothing until
        // an organizer says so.
        maxPerReviewer: '',
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Round added')
      refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={SlidersHorizontalIcon}
        title="Evaluation plan"
        description="Rounds, scorecards, weights and who reviews what."
        actions={
          <Button
            nativeButton
            variant="outline"
            onClick={() => router.push(`/admin/${eventId}/evaluation`)}
          >
            Back to Evaluation
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{plan === undefined ? 'Create a plan' : 'Plan'}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="plan-name">Name</Label>
            <Input id="plan-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="w-40 space-y-1.5">
            <Label htmlFor="plan-status">Status</Label>
            <Select
              // Base UI's `Select.Value` prints the raw value unless the root carries this
              // map, so the closed trigger read the status slug where the list read its
              // label.
              items={Object.fromEntries(STATUSES.map((entry) => [entry.value, entry.label]))}
              value={status}
              onValueChange={(next: string | null) => {
                if (next !== null) setStatus(next)
              }}
            >
              <SelectTrigger id="plan-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={pending} onClick={savePlan}>
            {plan === undefined ? 'Create plan' : 'Save plan'}
          </Button>
        </CardContent>
      </Card>

      {plan === undefined ? (
        <p className="text-sm text-muted-foreground">
          A plan holds the rounds and their criteria. Create one, then add the rounds it runs.
        </p>
      ) : (
        <>
          {view.rounds.map((round) => (
            <RoundCard
              key={round.id}
              eventId={eventId}
              planId={plan.id}
              round={round}
              reviewers={view.reviewers}
              timeZone={timeZone}
              onSaved={refresh}
            />
          ))}

          <div>
            <Button variant="outline" disabled={pending} onClick={addRound}>
              <PlusIcon />
              Add round
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
