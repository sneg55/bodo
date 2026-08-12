'use client'

// The round's own verdict: yes/no/maybe plus one comment about the submission.
//
// Boxed and titled so it cannot be mistaken for two more criteria. It used to render as
// two bare fields directly under the rubric, and on a round whose rubric already carried a
// "Recommendation" dropdown and a "Comments" free-text criterion, the page showed a second
// Recommendation with different options and a second comment box, with nothing on screen
// saying which was which.
//
// NOT removed, because it is wired: `scoreSubmission` tallies these into the Ratings cell's
// "Yes n, maybe n, no n" on the Abstracts table, the AI pre-screen writes one
// (features/jobs/prescreen-rubric.ts), and SPEC's stated minimum review pass is exactly
// `unreviewed -> approve/maybe/deny`. A rubric criterion cannot stand in for it: criteria
// are per-round fields an organizer invents, and nothing downstream knows that one of them
// was meant to mean "accept".
//
// Its own file rather than more JSX in `ScoreCard`, because the two conditionals here took
// that component past the cognitive-complexity ceiling the lint config enforces.

import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { REVIEW_RECOMMENDATIONS, type ReviewRecommendation } from '@/constants/status'
import { isRecommendation, recommendationLabel } from '@/features/review/review-draft'

/**
 * The pressed treatment, at the call site rather than in `ui/toggle`, because the generated
 * primitive is not ours to restyle and every other toggle in the app is happy with it.
 *
 * `Toggle`'s own pressed style is `bg-muted`, which on this palette is `oklch(0.195)` sitting
 * on a `--card` of `oklch(0.155)`: four points of lightness on a near-black panel. The 2026-08-12
 * eval run recorded the three buttons as "identical screenshots before and after" and could only
 * tell which was chosen by reading `aria-pressed` off the DOM. That is the wrong control to make
 * people squint at, because it IS the vote: `scoreSubmission` tallies it into the Ratings cell,
 * and a reviewer who cannot see their answer cannot see that they clicked the wrong one.
 *
 * Keyed on `aria-pressed`, which is what Base UI's `Toggle` actually flips.
 */
const PRESSED =
  'aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground'

export function RoundVerdict({
  recused,
  recommendation,
  comment,
  onRecommendation,
  onComment,
}: {
  /** Recused: the box holds a reason rather than a vote, and feeds no tally. */
  recused: boolean
  recommendation: ReviewRecommendation | undefined
  comment: string
  onRecommendation: (next: ReviewRecommendation) => void
  onComment: (next: string) => void
}) {
  return (
    <div className="flex flex-col gap-4 rounded-md border p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Your verdict</p>
        {recused ? null : (
          <p className="text-sm text-muted-foreground">
            Recorded against the round itself, not the rubric above. This is what the committee
            tally on the Abstracts table counts.
          </p>
        )}
      </div>

      {recused ? null : (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Recommendation</span>
          <ToggleGroup
            value={recommendation === undefined ? [] : [recommendation]}
            onValueChange={(next) => {
              const chosen = next[0]
              if (typeof chosen === 'string' && isRecommendation(chosen)) onRecommendation(chosen)
            }}
            variant="outline"
            size="sm"
          >
            {REVIEW_RECOMMENDATIONS.map((value) => (
              <ToggleGroupItem key={value} value={value} className={PRESSED}>
                {recommendationLabel(value)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {/* "Overall comment" rather than "Comment": a rubric can carry a free-text
            criterion of its own, and two boxes both labelled Comment gave a reviewer no way
            to tell which one the chair would read. */}
        <span className="text-sm font-medium">
          {recused ? 'Reason for recusal' : 'Overall comment'}
        </span>
        <Textarea
          rows={4}
          value={comment}
          placeholder={recused ? 'I work with one of the speakers.' : 'Enter text here...'}
          onChange={(event) => onComment(event.target.value)}
        />
      </div>
    </div>
  )
}
