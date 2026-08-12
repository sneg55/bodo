'use client'

// What a speaker sees after Save & finish later.
//
// NO LONGER TERMINAL. It used to be, and the reason was real: the draft is now a record, so
// a wizard left open behind this card would file a SECOND row on Submit. That objection is
// answered on the server instead, where `submitCfp` promotes the draft it finds rather than
// creating another (features/submissions/draft-promote.ts), so this card can offer the way
// back that CFP-07 asks for: Keep editing returns to the form with every answer still there.
//
// Two ways back, because they answer different questions. Keep editing is for this browser
// and needs nothing. Sign in is for a different device, and it deliberately does not link
// straight to /portal/submissions/{code}: an unauthenticated visitor sent there lands on
// /login anyway, which is the CFP-05 finding about the success card's redirect.
//
// The line about what the organizer can see was WRONG and is corrected below. It claimed
// the organizer cannot see a draft; the Abstracts table has a Drafts tab and lists these
// rows with a DRAFT chip. What is true is narrower: it is not in front of the review queue
// and no decision is made on it until it is submitted. Copy that contradicts the other
// screen is worse than copy that says less.

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SaveDraftSuccess } from '@/features/submissions/draft-actions'

const LOGIN_PATH = '/login'

export function DraftSavedCard({
  result,
  email,
  onKeepEditing,
}: {
  result: SaveDraftSuccess
  email: string
  onKeepEditing: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Badge variant="secondary">{result.code}</Badge>
        <h2 className="text-lg font-semibold">
          {result.updated ? 'Draft updated' : 'Draft saved'}
        </h2>
        <p className="text-sm text-muted-foreground">
          Nothing has been submitted yet. Your draft is saved against{' '}
          <span className="font-medium text-foreground">{email}</span>, so you can finish it from
          any browser or device.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Picking it back up</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            In this browser, keep editing now or just come back to this page later: your answers are
            still here and finishing them sends <span className="font-medium">{result.code}</span>{' '}
            rather than a second submission.
          </p>
          <p>
            On another device, sign in with that address and open{' '}
            <span className="font-medium">{result.code}</span> under Submissions.
          </p>
          <p>
            The organizer can see it listed as a draft, and nothing is reviewed or decided until you
            submit it. Submit it before the form closes.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onKeepEditing}>
              Keep editing
            </Button>
            <ButtonLink href={LOGIN_PATH} variant="outline">
              Sign in to finish later
            </ButtonLink>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
