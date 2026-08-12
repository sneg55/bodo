// The reviews on one submission, with their comments.
//
// A reviewer's free-text comment existed in the data and was rendered nowhere: the
// Abstracts table shows an aggregate percentage, the Evaluation queue shows a reviewer
// their OWN draft, and no surface in the product showed an organizer what the committee
// actually wrote. That is what a programme chair reads before a decision, and its absence
// is why the round-trip items could not be demonstrated.
//
// A server component: it renders text and has no state. The per-criterion breakdown is
// there so the number is accountable, because an aggregate with no visible parts is a
// figure an organizer has to trust rather than check.

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { AiOverrideControl } from '@/features/review/AiOverrideControl'
import { recommendationLabel } from '@/features/review/review-draft'
import type { ReviewEntry } from '@/features/review/submission-detail'

/**
 * One review's identity line: who, which round, what they scored, what they recommended.
 *
 * Its own component because three states have to be tellable apart on sight (a machine
 * score, a machine score a chair has overruled, and a person's), and folding those branches
 * into the list below put it over the complexity limit.
 */
function ReviewHeader({
  review,
  eventId,
  submissionId,
  canOverride,
}: {
  review: ReviewEntry
  eventId: string
  submissionId: string
  canOverride: boolean
}) {
  const { override } = review
  const recommendation = override?.recommendation ?? review.recommendation

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{review.reviewerName}</span>
      {/* Before the AI reviewer was named at all, this row said `Unknown reviewer` in
          exactly the treatment a human's gets. */}
      {review.isAi ? <Badge variant="outline">AI</Badge> : null}
      <Badge variant="secondary">{review.roundName}</Badge>
      {override === undefined ? null : (
        <>
          <Badge className="tabular-nums">{override.percent}%</Badge>
          <Badge variant="secondary">Overridden</Badge>
        </>
      )}
      {review.percent === undefined ? null : override === undefined ? (
        <Badge className="tabular-nums">{review.percent}%</Badge>
      ) : (
        // The machine's own number is kept on screen rather than replaced: an override a
        // reader cannot compare with what it overrode is just a different number.
        <span className="text-xs tabular-nums text-muted-foreground">
          AI scored {review.percent}%
        </span>
      )}
      {recommendation === undefined ? null : (
        <Badge variant="outline">{recommendationLabel(recommendation)}</Badge>
      )}
      {review.isAi && canOverride ? (
        <AiOverrideControl
          eventId={eventId}
          submissionId={submissionId}
          roundId={review.roundId}
          override={override}
          aiPercent={review.percent}
        />
      ) : null}
    </div>
  )
}

/**
 * When an override was recorded. UTC and explicit, the same rule the change history on this
 * page follows: it says when somebody typed, which is not an event-local fact.
 */
function overrideStamp(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(parsed)
}

export function ReviewHistory({
  reviews,
  eventId,
  submissionId,
  canOverride,
}: {
  reviews: readonly ReviewEntry[]
  eventId: string
  submissionId: string
  /** Admin only. A reviewer reads the committee's verdicts and overrules nobody. */
  canOverride: boolean
}) {
  if (reviews.length === 0) {
    return <p className="text-sm text-muted-foreground">No reviews yet.</p>
  }

  return (
    <ul className="flex flex-col gap-4">
      {reviews.map((review, index) => (
        <li key={review.id} className="flex flex-col gap-2 text-sm">
          {index === 0 ? null : <Separator className="mb-2" />}
          <ReviewHeader
            review={review}
            eventId={eventId}
            submissionId={submissionId}
            canOverride={canOverride}
          />

          {/* Said on the row rather than in a footnote, because the number beside it is a
              percentage in the same shape as a human reviewer's and nothing else on the page
              distinguishes what it is allowed to decide. */}
          {review.isAi ? (
            <p className="text-xs text-muted-foreground">
              Pre-screen. Not counted in the committee average, and neither is an override.
            </p>
          ) : null}

          {review.override === undefined ? null : (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                Overridden by {review.override.by} on {overrideStamp(review.override.at)}
              </span>
              {review.override.note === undefined ? null : (
                <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3">
                  {review.override.note}
                </blockquote>
              )}
            </div>
          )}

          {review.scores.length === 0 ? null : (
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
              {review.scores.map((score) => (
                <div key={score.label} className="flex items-baseline gap-1.5">
                  <dt>{score.label}</dt>
                  {/* Already resolved to what the reviewer actually picked
                      (`criterion-answer.ts`). A dropdown stores the number its option
                      carries, so a Recommendation answered "Accept" printed here as
                      `1/3`, under the criterion's own name, with nothing on the page
                      saying what 1 meant. */}
                  <dd className="font-medium tabular-nums text-foreground">{score.text}</dd>
                  {/* Weights are invisible everywhere else, which is why an aggregate can
                      read as wrong: a 42% where an equal-weight mean would be 60% is
                      correct and unexplained until the weight is on screen. */}
                  {score.weight === 1 ? null : <dd className="text-xs">x{score.weight}</dd>}
                </div>
              ))}
            </dl>
          )}

          {/* Answers to the round's free-text criteria, each under its own criterion
              name. Without these the block said "No comment." on a review whose only
              prose was filed against a "Comments" criterion, which is where a reviewer
              writes when the organizer put the box in the rubric rather than using the
              round's own comment field. */}
          {review.notes.map((note) => (
            <div key={note.label} className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{note.label}</span>
              <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3">
                {note.text}
              </blockquote>
            </div>
          ))}

          {review.comment === undefined ? (
            review.notes.length === 0 ? (
              <p className="text-muted-foreground">No comment.</p>
            ) : null
          ) : (
            <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3">
              {review.comment}
            </blockquote>
          )}
        </li>
      ))}
    </ul>
  )
}
