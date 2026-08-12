'use client'

// The `Merge` control in the directory toolbar, and everything behind it.
//
// Its own file rather than more state in `CrmDirectory`: that component is the table's
// controller (query state, columns, density) and this is a self-contained transaction over
// the rows it has selected. The split also keeps both under the 300-line budget.
//
// It renders NOTHING until two rows are ticked, which is the honest state of the control: a
// merge of one record is not a merge, and a disabled button an organizer cannot explain is
// the shape .claude memory calls a dead control. The row checkboxes are the affordance that
// makes it appear, and the duplicate badges are what tells them which rows to tick.

import { MergeIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { MergeSpeakersDialog } from '@/features/crm/MergeSpeakersDialog'
import { mergeSpeakersAction } from '@/features/crm/merge-actions'
import type { SpeakerRow } from '@/features/crm/speaker-rows'

export type MergeSpeakersButtonProps = {
  /** The ticked rows, in table order. */
  rows: readonly SpeakerRow[]
  /** Called after a successful merge, so the selection does not keep naming deleted ids. */
  onMerged: () => void
}

export function MergeSpeakersButton({ rows, onMerged }: MergeSpeakersButtonProps) {
  const [open, setOpen] = useState(false)
  const [primaryId, setPrimaryId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (rows.length < 2) return null

  // The first ticked row unless the organizer has picked another, and re-derived rather than
  // stored on open: the selection can change underneath a closed dialog, and a `primaryId`
  // left pointing at an unticked row would send the action a primary it will refuse.
  const chosen = rows.find((row) => row.speaker.id === primaryId)?.speaker.id
  // `.at(0)` and not `[0]`: indexing a readonly array types as a present element, so the
  // fallback would read as unnecessary to the compiler while still being reachable.
  const primary = chosen ?? rows.at(0)?.speaker.id ?? ''

  // `startTransition(async () => ...)` and not the sync-callback shape: see the note in
  // SpeakerListPicker. The second form leaves `pending` false in the same tick, which makes
  // every `disabled={pending}` decorative and lets a second click merge again - against
  // records the first click has already deleted.
  const confirm = () => {
    startTransition(async () => {
      const result = await mergeSpeakersAction({
        primaryId: primary,
        speakerIds: rows.map((row) => row.speaker.id),
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setOpen(false)
      setPrimaryId(null)
      onMerged()
      toast.success(summarize(result.absorbed, result.sessionsDeduplicated))
    })
  }

  return (
    <>
      <Button variant="outline" disabled={pending} onClick={() => setOpen(true)}>
        <MergeIcon data-icon="inline-start" />
        {`Merge ${rows.length}`}
      </Button>
      <MergeSpeakersDialog
        open={open}
        rows={rows}
        primaryId={primary}
        onPrimaryChange={setPrimaryId}
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={confirm}
      />
    </>
  )
}

/**
 * What the toast says, and it says more than "Saved successfully" on purpose: this is the one
 * action in the CRM that deleted something, so the count of what went is the confirmation.
 * Deduplicated session rows are named only when there were any, because "0 duplicate session
 * entries removed" reads as a warning about something that did not happen.
 */
function summarize(absorbed: number, deduplicated: number): string {
  const merged = `${absorbed} record${absorbed === 1 ? '' : 's'} merged`
  if (deduplicated === 0) return merged
  return `${merged}, ${deduplicated} duplicate session ${deduplicated === 1 ? 'entry' : 'entries'} removed`
}
