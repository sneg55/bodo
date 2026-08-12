// The Review progress card and the actionable banners, refs 36 and 37.
//
// Server components with no interactivity, like the rest of the home: every number was
// counted by review-progress.ts and attention.ts on the server, so nothing here can render
// a total the page did not compute.
//
// Ref 37 outlines the card in amber. That is not reproduced, because the only colours in
// this build come from the shadcn token layer and bodo's palette deliberately differs from
// Sessionboard's (.claude/rules/ui-shadcn.md). Layout, labels and copy are the parity
// targets; a hardcoded amber border would break dark mode to match a hue nobody scores.

import { ChevronRightIcon, ClipboardListIcon, UserRoundIcon, UsersIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { AttentionBanner } from '@/features/dashboard/attention'
import type { ReviewProgressView } from '@/features/dashboard/review-progress'

/** Verbatim ref 37. Shown until the first assignment exists, not until the first review. */
const EMPTY_STATE = 'Reviewer assignments will appear here once evaluations begin.'

/**
 * The two banners from ref 36, each a sentence with the count and the link that acts on it.
 *
 * Nothing renders when the list is empty: `attentionBanners()` returns only the checks that
 * fired, so there is no "0 submissions are awaiting a decision" state to style.
 */
export function AttentionBanners({ banners }: { banners: readonly AttentionBanner[] }) {
  if (banners.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {banners.map((banner) => (
        <Alert key={banner.id} className="items-center">
          {/* The two checks are about different things, so they do not share an icon: one is
              a pile of submissions to decide, the other is a person to chase. */}
          {banner.id === 'profiles' ? <UserRoundIcon /> : <ClipboardListIcon />}
          <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-foreground">{banner.text}</span>
            <Link
              href={banner.href}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {banner.actionLabel}
            </Link>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  )
}

/**
 * Ref 36's "Program snapshot": the heading, the "View participants" link, the banners, and the
 * two panels underneath.
 *
 * Those panels (PARTICIPANTS BY ROLE's stacked bar and the SUBMISSION STATUS donut) arrive as
 * `children` rather than being rendered here, because they need reads and aggregates this
 * component has no business knowing about, and because the Participants sub-tab is the only
 * place they belong.
 */
export function ProgramSnapshot({
  banners,
  participantsHref,
  children,
}: {
  banners: readonly AttentionBanner[]
  participantsHref: string
  children?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-medium">Program snapshot</h2>
        <Link
          href={participantsHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          <UsersIcon className="size-3.5" />
          View participants
        </Link>
      </div>
      <AttentionBanners banners={banners} />
      {children}
    </section>
  )
}

export function ReviewProgressCard({
  view,
  evaluationHref,
}: {
  view: ReviewProgressView
  evaluationHref: string
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Review progress</CardTitle>
          <Link
            href={evaluationHref}
            className="inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Open evaluation
            <ChevronRightIcon className="size-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ReviewerList view={view} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ReviewStat label="Evaluation 2.0 plans" value={view.plans} />
          <ReviewStat label="Evaluated submissions" value={view.evaluatedSubmissions} />
          {/* Ref 37 labels this tile "Reviews in progress" and captures it at 0, where every
              reading of the words agrees. They stop agreeing the moment there is work: the
              number is ASSIGNMENTS with no saved review, and a review with nothing saved
              against it has not been started, so a committee 10 reviews into 40 read
              "Reviews in progress 30" while 30 was exactly the count nobody had opened. A
              review here is saved or it is not, so there is no in-progress state for the
              captured label to be true of, and the label names the count instead. */}
          <ReviewStat label="Reviews not started" value={view.reviewsInProgress} />
        </div>

        {view.mostActivePlanName === undefined ? null : (
          <p className="text-xs text-muted-foreground">
            {`Most active plan: ${view.mostActivePlanName}`}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Ref 37's dashed empty box, or a row per reviewer holding work.
 *
 * The empty state is gated on `assigned` and not on the row count, because the captured
 * sentence is a claim about the plan, not about this list: with assignments in flight but
 * every reviewer's membership since removed, "once evaluations begin" would be a lie the
 * tiles beside it contradict. That case draws no list and lets the tiles speak.
 */
function ReviewerList({ view }: { view: ReviewProgressView }) {
  if (view.assigned === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-pretty text-muted-foreground">
        {EMPTY_STATE}
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-4">
      {view.reviewers.map((reviewer) => (
        <li key={reviewer.id} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{reviewer.name}</span>
            <span className="whitespace-nowrap text-muted-foreground tabular-nums">
              {`${reviewer.reviewed} of ${reviewer.assigned} reviewed`}
            </span>
          </div>
          {/* `assigned` is never 0 on a row: reviewerRows() only emits reviewers who hold at
              least one assignment, so this ratio has a denominator. */}
          <Progress value={(reviewer.reviewed / reviewer.assigned) * 100} />
        </li>
      ))}
    </ul>
  )
}

function ReviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
