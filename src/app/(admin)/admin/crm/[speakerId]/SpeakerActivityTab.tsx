'use client'

// The profile's Notes and Activity panel: the internal-note feed, and the record of every
// stage move.
//
// The two are the halves CRM-08 reported missing. A pipeline card that opens to a detail view
// needs "what did we say about this person" and "how did they get to this column", and this
// build had neither: the Communication tab is timestamped but lists sent EMAIL only, so two
// stage moves in a row left no trace anywhere in the product.
//
// They sit on one tab rather than two because they are read together. An organizer asking why
// somebody is in Declined wants the move and the note that explains it next to each other,
// and a tab strip that made them choose would put a half-answer behind each choice.
//
// Both feeds are READ-ONLY and append-only. The stage history has no control of its own: a
// stage is moved with the Move-to menu in the page header, which is the same control the
// board's cards carry, and adding a second one here would be two ways to write the same
// column from one screen.
//
// EVERY TIMESTAMP HERE ALREADY NAMES THE CLOCK IT IS ON (`Aug 10, 2026, 2:38 PM PDT`), and
// it is the same clock the Communication tab and the Details tab's `Last invited` are on.
// The zone is part of `atText`, rendered on the server by `profileActivityRows`, so nothing
// on this surface formats a date or adds a footnote about one. Do not strip it: an
// unlabelled timestamp beside a labelled one is what the eval run of 2026-08-10 filed as a
// seven-hour skew. See `profileTimezone` for the rule.
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe.

import { ArrowRightIcon } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { ProfileActivity } from '@/features/crm/profile-activity'
import { SpeakerNotesPanel } from '@/features/crm/SpeakerNotesPanel'

export function SpeakerActivityTab({
  speakerId,
  activity,
  canWrite,
}: {
  speakerId: string
  activity: ProfileActivity
  /** False for a reviewer, which is what removes the composer. See `SpeakerNotesPanel`. */
  canWrite: boolean
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SpeakerNotesPanel speakerId={speakerId} notes={activity.notes} canWrite={canWrite} />
      <StageHistoryCard history={activity.stageHistory} />
    </div>
  )
}

function StageHistoryCard({ history }: { history: ProfileActivity['stageHistory'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage History</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-0">
        {history.length === 0 ? (
          // States what an empty list means rather than leaving a blank card. A contact
          // created by a CFP submission has never been MOVED, so no history is the ordinary
          // case rather than a sign that something failed to record.
          <p className="text-sm text-muted-foreground">
            No stage moves recorded yet. Moves made from here or from the pipeline are logged.
          </p>
        ) : (
          history.map((entry, index) => (
            <div key={entry.id}>
              {index === 0 ? null : <Separator className="my-3" />}
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">{entry.fromLabel}</span>
                <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="font-medium">{entry.toLabel}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {`${entry.authorName}${entry.atText === '' ? '' : ` · ${entry.atText}`}`}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
