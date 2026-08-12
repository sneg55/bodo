'use client'

// The Evaluation surface: the active plan, its rounds, the reviewer's queue, and (for an
// admin) committee assignment.
//
// The selected round and the selected submission live in the URL, not in state, for the
// same reason the Abstracts query does: a reviewer who reloads mid-review lands back where
// they were, and a link to a submission is a link somebody can send.
//
// There are no screenshots of this surface at all (the parity audit lists Evaluation as
// uncaptured), so the layout is built from what BUILD_SPEC 5.4 describes rather than
// invented to look like a screen nobody has: plan in the header, rounds as a tab strip
// with per-round progress, queue on the left, score sheet on the right.

import { StarIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { EvaluationView, RoundSummary } from '@/features/review/evaluation-view'
import { cn } from '@/utils/cn'

import { CommitteePanel } from './CommitteePanel'
import { ExportResultsButton } from './ExportResultsButton'
import { PrescreenPanel } from './PrescreenPanel'
import { ReviewerProgressPanel } from './ReviewerProgressPanel'
import { ReviewQueueList } from './ReviewQueueList'
import { RoundProgress } from './RoundProgress'
import { ScoreCardSlot } from './ScoreCardSlot'

export type EvaluationPanelProps = {
  eventId: string
  view: EvaluationView
  /** From `?submission=`. Falls back to the first item in the queue. */
  selectedSubmissionId?: string
}

export function EvaluationPanel({ eventId, view, selectedSubmissionId }: EvaluationPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  // The round tabs navigate, and the destination is an Airtable-backed dynamic route: on the
  // seeded event the round the organizer clicked took several seconds to arrive. Without a
  // transition there is nothing on screen for those seconds, so the previous round's panel
  // sat there looking current, and a second click was what "fixed" it.
  //
  // `useTransition` rather than dropping the URL: the URL stays the source of truth, because
  // a reviewer who reloads mid-review has to land back on the same round and the same
  // submission, and a link to one is a link somebody can send.
  const [pending, startTransition] = useTransition()
  // Which round the organizer ASKED for, held only while the navigation is in flight. The
  // tab strip is otherwise driven by the server's answer, which is still the old round until
  // the new render lands, so the tab they clicked would spring back under the pointer.
  const [askedRoundId, setAskedRoundId] = useState<string | undefined>(undefined)

  const activeRound = view.rounds.find((round) => round.id === view.activeRoundId)
  const selected =
    view.queue.find((item) => item.submissionId === selectedSubmissionId) ?? view.queue.at(0)
  // Falls back to the server's answer the moment the transition ends, so nothing has to
  // clear `askedRoundId`: a navigation that failed or was superseded shows the round the
  // page is actually on rather than one it never reached.
  const shownRoundId = pending ? (askedRoundId ?? view.activeRoundId) : view.activeRoundId

  const go = (roundId: string | undefined, submissionId: string | undefined) => {
    const params = new URLSearchParams()
    if (roundId !== undefined) params.set('round', roundId)
    if (submissionId !== undefined) params.set('submission', submissionId)
    const query = params.toString()
    startTransition(() => {
      router.replace(query.length === 0 ? pathname : `${pathname}?${query}`, { scroll: false })
    })
  }

  const nextAfter = (submissionId: string): string | undefined => {
    const index = view.queue.findIndex((item) => item.submissionId === submissionId)
    return view.queue.at(index + 1)?.submissionId
  }

  if (view.plan === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No evaluation plan yet</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
          <p>
            An evaluation plan holds the rounds and their criteria. Create one before assigning
            reviewers.
          </p>
          {/* This used to say "Create one" with nothing behind it, which is how the plan
              editor came to be missing rather than broken. */}
          {view.role === 'admin' ? (
            <ButtonLink href={`/admin/${eventId}/evaluation/plan`}>Create a plan</ButtonLink>
          ) : null}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={StarIcon}
        title="Evaluation"
        // The plan is NAMED rather than hidden: one active plan per event ships and the
        // schema allows more, so saying which one you are in costs a line now and a
        // migration later if it is left implicit. Section 3.
        description={view.plan.name}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{view.role}</Badge>
            {view.role === 'admin' ? (
              <>
                {/* The results file, next to the plan that defines what is in it. Admin
                    only, because it attributes every verdict to the reviewer who gave it;
                    the action re-checks that for itself. */}
                <ExportResultsButton eventId={eventId} roundId={view.activeRoundId} />
                <ButtonLink variant="outline" href={`/admin/${eventId}/evaluation/plan`}>
                  Edit plan
                </ButtonLink>
              </>
            ) : null}
          </div>
        }
      />

      {/* `shownRoundId` is the clicked round while a navigation is in flight, so the tab
          highlights at once instead of waiting for the server. The `h-auto min-h-8` on the
          list is main's fix for a wrapped strip printing its tabs over each other. */}
      {view.rounds.length === 0 ? null : (
        <Tabs
          value={shownRoundId}
          onValueChange={(next: string) => {
            setAskedRoundId(next)
            go(next, undefined)
          }}
        >
          <TabsList variant="line" className="group-data-horizontal/tabs:h-auto min-h-8 flex-wrap">
            {view.rounds.map((round) => (
              <TabsTrigger key={round.id} value={round.id}>
                {round.name}
                <Badge variant="secondary">
                  {round.reviewed}/{round.assigned}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* Everything below the tabs belongs to the round the SERVER has answered with, so
          while a navigation is in flight it is the previous round's. Dimmed and marked busy
          rather than blanked: the numbers stay readable, and it is visible that they are
          about to be replaced. Not `pointer-events-none`, because a navigation that never
          lands must not take the panel with it. */}
      <div
        aria-busy={pending}
        className={cn(
          'flex flex-col gap-4 transition-opacity',
          pending ? 'opacity-50' : 'opacity-100',
        )}
      >
        {activeRound === undefined ? null : <RoundProgress round={activeRound} pending={pending} />}

        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <ReviewQueueList
            queue={view.queue}
            selectedId={selected?.submissionId}
            onSelect={(submissionId) => go(view.activeRoundId, submissionId)}
          />

          <Card className="min-w-0">
            <CardContent className="pt-6">
              <ScoreCardSlot
                eventId={eventId}
                pending={pending}
                round={activeRound}
                selected={selected}
                onNext={
                  selected === undefined
                    ? undefined
                    : (() => {
                        const next = nextAfter(selected.submissionId)
                        return next === undefined
                          ? undefined
                          : () => {
                              go(view.activeRoundId, next)
                            }
                      })()
                }
                onSaved={() => {
                  // The write already expired the tags it touched (`invalidate` inside
                  // `saveReview`), so this only asks the router for the render that reads
                  // them again. Without it the queue's check mark and the round tab's count
                  // stayed at their pre-save values until something else navigated: the
                  // reviewer had scored the submission and the panel said otherwise.
                  router.refresh()
                }}
              />
            </CardContent>
          </Card>
        </div>

        {/* Admin only, and on the ACTIVE round: pre-screening is scoped to one rubric, and a
            control that did not say which round it meant would be the one thing an
            organizer could not undo. */}
        {view.role === 'admin' && activeRound === undefined ? null : (
          <ChairPanels eventId={eventId} view={view} round={activeRound} />
        )}
      </div>
    </div>
  )
}

/**
 * The three cards only a chair sees, lifted out of `EvaluationPanel`.
 *
 * Extracted when the AI pre-screen card landed beside the reviewer-progress card and the
 * panel went past the complexity limit: three copies of the same
 * `role === 'admin' && activeRound !== undefined` guard, each wrapping a card, is one
 * question asked three times. Asking it once here also means a fourth chair control is an
 * edit to this function rather than a fourth guard.
 */
function ChairPanels({
  eventId,
  view,
  round,
}: {
  eventId: string
  view: EvaluationView
  round: RoundSummary | undefined
}) {
  if (view.role !== 'admin' || round === undefined) return null

  return (
    <>
      {view.prescreen === undefined ? null : (
        <Card>
          <CardHeader>
            <CardTitle>AI pre-screen</CardTitle>
          </CardHeader>
          <CardContent>
            <PrescreenPanel
              eventId={eventId}
              roundId={round.id}
              roundName={round.name}
              prescreen={view.prescreen}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Reviewer progress</CardTitle>
        </CardHeader>
        <CardContent>
          <ReviewerProgressPanel eventId={eventId} roundId={round.id} rows={view.progress} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assign reviewers</CardTitle>
        </CardHeader>
        <CardContent>
          <CommitteePanel
            eventId={eventId}
            roundId={round.id}
            roundName={round.name}
            teams={view.teams}
            reviewers={view.reviewers}
            submissions={view.assignable}
          />
        </CardContent>
      </Card>
    </>
  )
}
