'use client'

// The roster's search box and its bulk bar, in one row.
//
// Split out of `SpeakerRosterPanel` when the bulk bar gained the composer (SPK-13) and the
// panel crossed the 300 line limit. The split is along a real seam rather than an arbitrary
// one: everything here is a CONTROL, and the panel that stays behind is the table plus the
// state those controls act on. Nothing here holds state of its own, which is why the four
// callbacks are props: the selection, the roster rows and the search text all belong to the
// list they filter.
//
// The three sheet-backed controls each own their own drawer, so this file has no drawer state
// either. Their order is the order an organizer reaches for them: add one person, write to the
// people who are ticked, then the bulk import that fills the list in the first place.

import { SearchIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BulkEmailButton } from '@/features/comms/BulkEmailButton'
import { AddSpeakerSheet } from '@/features/speakers/AddSpeakerSheet'
import { InviteSpeakersButton } from '@/features/speakers/InviteSpeakersButton'
import { SpeakerImportSheet } from '@/features/speakers/SpeakerImportSheet'

export function SpeakerRosterToolbar({
  eventId,
  query,
  onQueryChange,
  selectedIds,
  onInvited,
  onSent,
  onRefresh,
}: {
  eventId: string
  query: string
  onQueryChange: (next: string) => void
  /** Already intersected with what the table is SHOWING. See the panel. */
  selectedIds: readonly string[]
  onInvited: (invited: { ids: readonly string[]; invitedAt: string }) => void
  onSent: () => void
  onRefresh: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="relative min-w-56 flex-1 sm:max-w-sm">
        <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search speakers"
          aria-label="Search speakers"
          className="pl-8 pr-8"
        />
        {/* The same clear control the DataTable toolbar carries, for the same reason: the only
            evidence a roster is still narrowed is the row count against the tab count, so an
            organizer who believes they have cleared the box is shown a short list with no
            visible filter on it. Rendered only when there is a query to clear. */}
        {query === '' ? null : (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear search"
            className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
            onClick={() => onQueryChange('')}
          >
            <XIcon />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* SPK-01. The roster could be filled by a CFP submission or by a CSV, and neither is
            what an organizer does when one person says yes over email. */}
        <AddSpeakerSheet eventId={eventId} onAdded={onRefresh} />
        {/* SPK-13. The general-purpose send, beside the transactional one. The invitation stays
            its own control because it carries an `invitedAt` stamp and its own idempotency;
            this one takes an arbitrary subject and body and logs the same way. */}
        <BulkEmailButton eventId={eventId} speakerIds={selectedIds} onSent={onSent} />
        {/* SPK-06. Sends to what is TICKED, so one speaker and a whole cohort are the same
            control rather than a row action and a bulk action that can drift apart. */}
        <InviteSpeakersButton eventId={eventId} speakerIds={selectedIds} onInvited={onInvited} />
        {/* `refresh()` reruns the client router so the new rows arrive from the server. The
            import already invalidated the speaker tags server-side; this is not doing that
            job, it is getting this browser to ask again. */}
        <SpeakerImportSheet eventId={eventId} onImported={onRefresh} />
      </div>
    </div>
  )
}
