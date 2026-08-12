// The near-neighbours of one submission, as a reviewer sees them.
//
// The whole point of the feature is on this surface: a reviewer scoring SESS-1 is told "94%
// similar to SESS-142" before they write a comment, rather than discovering the duplicate two
// hundred abstracts later, or not at all. It renders the code, the title and the percentage
// and nothing else, because the decision it supports is only "open that one and compare".
//
// A server component with no state and no fetch. It takes the result of `similarTo` as plain
// props for the same reason `similarity.ts` takes rows instead of reading them: the scoring is
// pure, so the panel stays a function of its arguments and can be dropped into the scorecard,
// the abstract detail page, or a Suspense boundary above a slow read without any of them
// having to know how similarity is computed.
//
// `dropped` is rendered, not ignored. A panel that shows nothing after a capped sweep looks
// exactly like a panel that compared the whole round and found nothing, and a reviewer who
// reads the empty state as "no duplicates" has been misled by an omission. See
// `SimilarityCoverage`.

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type SimilarNeighbour, similarityPercent } from '@/features/review/similarity'

/**
 * A near-duplicate and a same-topic neighbour are different findings, and the chip is the only
 * thing that separates them at a glance: at 85% the two abstracts are the same text edited,
 * which is a resubmission to resolve, while a 60% match is two people who chose one topic,
 * which is a programme decision and not a problem. The stronger variant is reserved for the
 * first so the panel does not shout about the second.
 */
const NEAR_DUPLICATE = 0.85

export function SimilarPanel({
  neighbours,
  dropped = 0,
}: {
  neighbours: readonly SimilarNeighbour[]
  /** Rows the cap left uncompared, from `SimilarityCoverage.dropped`. */
  dropped?: number
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Similar submissions</CardTitle>
        <CardDescription>
          {/* Named rather than left implicit: a percentage with no stated basis reads as a
              model's opinion, and a reviewer who thinks a model produced it will either
              over-trust it or dismiss it. It is text overlap, and saying so is what makes a
              62% match interpretable. */}
          Compared on title and abstract text.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {neighbours.length === 0 ? (
          <p className="text-sm text-muted-foreground">No similar submissions.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {neighbours.map((neighbour) => (
              <li key={neighbour.row.id} className="flex items-baseline gap-2 text-sm">
                <Badge
                  variant={neighbour.score >= NEAR_DUPLICATE ? 'default' : 'secondary'}
                  className="tabular-nums"
                >
                  {similarityPercent(neighbour.score)}%
                </Badge>
                <span className="font-medium whitespace-nowrap">{neighbour.row.code}</span>
                {/* Truncated rather than wrapped: the panel sits beside a scorecard, and a
                    three-line title would push the next match off the screen, which is the
                    one the reviewer has not seen yet. */}
                <span className="truncate text-muted-foreground">{neighbour.row.title}</span>
              </li>
            ))}
          </ul>
        )}

        {dropped === 0 ? null : (
          <p className="text-xs text-muted-foreground">
            {dropped} submission{dropped === 1 ? '' : 's'} not compared.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
