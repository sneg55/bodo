'use client'

// The right-hand end of the SUBMISSIONS toolbar: the Track filter, and the bulk actions
// that appear once rows are ticked.
//
// Split out of `AbstractsTable` when that file crossed the size budget, and it is a seam
// rather than a slice: these two are the controls scoped to the CURRENT SELECTION and the
// current category, while everything left behind is about the table as a whole.
//
// Track is matched on the record ID rather than the name, which is why this takes the
// option list and hands an id back: a track renamed mid-cycle would otherwise silently
// empty a filtered view, and Track is the review category that routing and reviewer
// assignment both key on (schema section 3).

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { AbstractsBulkActions } from './AbstractsBulkActions'

/** The "no track chosen" sentinel. Not a record id, so it cannot collide with one. */
export const ALL_TRACKS = 'all'

const ALL_TRACKS_LABEL = 'All tracks'

export type AbstractsToolbarExtraProps = {
  eventId: string
  tracks: readonly { id: string; name: string }[]
  trackId?: string
  onTrackChange: (trackId: string) => void
  /** A reviewer reads this table; only an admin gets the bulk actions. */
  canEdit: boolean
  selectedIds: readonly string[]
  onSelectionClear: () => void
}

export function AbstractsToolbarExtra({
  eventId,
  tracks,
  trackId,
  onTrackChange,
  canEdit,
  selectedIds,
  onSelectionClear,
}: AbstractsToolbarExtraProps) {
  return (
    <>
      <Select
        // Without this the closed trigger read `all` rather than "All tracks", and a chosen
        // track read its record id: Base UI's `Select.Value` prints the raw value unless the
        // root carries this map.
        items={{
          [ALL_TRACKS]: ALL_TRACKS_LABEL,
          ...Object.fromEntries(tracks.map((track) => [track.id, track.name])),
        }}
        value={trackId ?? ALL_TRACKS}
        onValueChange={(next: string | null) => {
          onTrackChange(next === null || next === ALL_TRACKS ? '' : next)
        }}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_TRACKS}>{ALL_TRACKS_LABEL}</SelectItem>
          {tracks.map((track) => (
            <SelectItem key={track.id} value={track.id}>
              {track.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {canEdit ? (
        <AbstractsBulkActions
          eventId={eventId}
          selectedIds={selectedIds}
          onDone={onSelectionClear}
        />
      ) : null}
    </>
  )
}
