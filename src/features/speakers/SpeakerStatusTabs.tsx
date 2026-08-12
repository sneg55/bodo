'use client'

// The roster's status filter strip, and the one sentence that says what its counts mean.
//
// Split out of `SpeakerRosterPanel` when that file crossed the file-size limit, along the
// seam that was already there: everything here is about the SPEAKER status vocabulary, and
// nothing here knows about search, selection or the table.
//
// It is labelled rather than left as a bare row of tabs because "confirmed" means three
// different things in this admin. This strip counts `Speakers.status`, the organizer's own
// record of whether a person is coming. The dashboard's Speaker Tracking widget counts a
// portal confirmation task, and the Submissions column counts an accepted session, so a
// roster reading `Confirmed 0` beside a widget reading `4 Confirmed` is two true statements
// about different things. Saying which one this is costs a label.

import { InfoIcon } from 'lucide-react'

import { MetaLabel } from '@/components/primitives/MetaLabel'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SPEAKER_STATUSES, type SpeakerStatus, speakerStatusLabel } from '@/constants/status'

/** Shown against the strip and against the table's status column, so the two agree. */
export const SPEAKER_STATUS_HELP =
  'The organizer’s record of whether this person is coming, set here on the roster. Confirmed does not mean their session was accepted, and it is not the confirmation task counted on the dashboard.'

export const SPEAKER_STATUS_HEADING = 'Speaker status'

export function SpeakerStatusInfo() {
  return (
    <Tooltip>
      {/* 28px, not 40: this renders both in a table header and above the tab strip below,
          and the strip is the tighter of the two. From the 14px glyph's centre there is 7px
          of label row, the `gap-1.5`, and the list's 3px padding before the first tab, so
          14px in each direction is what fits. */}
      <TooltipTrigger className="text-muted-foreground hit-area-[28px]">
        <InfoIcon className="size-3.5" />
        <span className="sr-only">About {SPEAKER_STATUS_HEADING}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-pretty">{SPEAKER_STATUS_HELP}</TooltipContent>
    </Tooltip>
  )
}

export function SpeakerStatusTabs({
  status,
  total,
  countOf,
  onChange,
}: {
  status: SpeakerStatus | 'all'
  /** Everyone on the roster, for the All tab. */
  total: number
  countOf: (status: SpeakerStatus) => number
  onChange: (status: SpeakerStatus | 'all') => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5">
        <MetaLabel>{SPEAKER_STATUS_HEADING}</MetaLabel>
        <SpeakerStatusInfo />
      </span>

      <Tabs
        value={status}
        onValueChange={(next: string) => {
          const found = SPEAKER_STATUSES.find((known) => known === next)
          onChange(found ?? 'all')
        }}
      >
        <TabsList variant="line" className="group-data-horizontal/tabs:h-auto min-h-8 flex-wrap">
          <TabsTrigger value="all">
            All
            <Badge variant="secondary" className="tabular-nums">
              {total}
            </Badge>
          </TabsTrigger>
          {/* A status with nobody in it still gets a tab, unlike the embed's facets: this
              strip is also how an organizer learns the vocabulary exists, and an empty
              Confirmed tab is a true statement about the event rather than a dead control. */}
          {SPEAKER_STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {speakerStatusLabel(value)}
              <Badge variant="secondary" className="tabular-nums">
                {countOf(value)}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
