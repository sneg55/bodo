'use client'

// The "which abstracts" half of committee assignment: the track filter, select-all, and the
// checkbox list.
//
// Lifted out of CommitteePanel.tsx when the committee eligibility warning landed there and
// pushed that file past the size limit. The seam is real rather than arithmetic: everything
// here is about the submissions, and everything left behind is about the people.

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AssignableSubmission } from '@/features/review/evaluation-view'

export const ALL_TRACKS = 'all'

export function SubmissionPicker({
  submissions,
  selected,
  onSelected,
}: {
  /** Everything that needs review, unfiltered: the track filter lives here. */
  submissions: readonly AssignableSubmission[]
  selected: readonly string[]
  onSelected: (next: readonly string[]) => void
}) {
  const [trackId, setTrackId] = useState<string>(ALL_TRACKS)

  const tracks = new Map(
    submissions.flatMap((submission) =>
      submission.trackId === undefined || submission.trackName === undefined
        ? []
        : [[submission.trackId, submission.trackName] as const],
    ),
  )
  const visible = submissions.filter(
    (submission) => trackId === ALL_TRACKS || submission.trackId === trackId,
  )
  // value -> label for the select. Built from the same map that renders the options, so a
  // label can never disagree with the list it came from: Base UI's `Select.Value` prints the
  // raw VALUE unless the root can map it, which is how a trigger came to read `recTrk1`.
  const trackItems: Record<string, string> = {
    [ALL_TRACKS]: 'All tracks',
    ...Object.fromEntries([...tracks]),
  }

  const toggle = (id: string, checked: boolean) => {
    onSelected(
      checked
        ? [...selected.filter((entry) => entry !== id), id]
        : selected.filter((entry) => entry !== id),
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Label>Submissions</Label>
        <Select
          items={trackItems}
          value={trackId}
          onValueChange={(next: string | null) => {
            if (next !== null) setTrackId(next)
          }}
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TRACKS}>All tracks</SelectItem>
            {[...tracks].map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        variant="ghost"
        size="xs"
        className="self-start"
        onClick={() => onSelected(visible.map((submission) => submission.id))}
      >
        Select all {visible.length}
      </Button>

      <ScrollArea className="h-56 rounded-lg border border-border p-2">
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submissions need review in this track.</p>
        ) : null}
        {visible.map((submission) => (
          <Label key={submission.id} className="flex items-center gap-2 py-1 font-normal">
            <Checkbox
              checked={selected.includes(submission.id)}
              onCheckedChange={(checked) => toggle(submission.id, checked)}
            />
            <span className="text-xs tabular-nums text-muted-foreground">{submission.code}</span>
            <span className="truncate">{submission.title}</span>
          </Label>
        ))}
      </ScrollArea>
    </>
  )
}
