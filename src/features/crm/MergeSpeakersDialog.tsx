'use client'

// The confirmation in front of the CRM's only irreversible write.
//
// `AlertDialog` and not `Dialog`, per .claude/rules/ui-shadcn.md: it is the destructive
// confirmation primitive, and this is the one place in the CRM where pressing a button
// deletes somebody else's records. It carries the choice as well as the confirmation, which
// is deliberate rather than lazy - a two-step flow (pick a primary in one dialog, confirm in
// another) would show the consequences on a screen that no longer shows what was picked, and
// the whole point of the sentence below is that it names the record that survives.
//
// The primary is a `RadioGroup` over the selected rows, defaulting to the FIRST one rather
// than to nothing. A destructive dialog that opens with its most important control unset
// invites Enter, and there is no defensible "no primary" outcome to leave it in: something has
// to survive. The default is the first row in the table's own order, which is the row the
// organizer's eye is already on.
//
// The consequence sentence comes from `mergeSummary` in merge.ts, not from JSX here, so it is
// asserted by a test rather than by somebody reading this file.

import { ScrollPanel } from '@/components/primitives/ScrollPanel'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { mergeSummary } from '@/features/crm/merge'
import type { SpeakerRow } from '@/features/crm/speaker-rows'
import { speakerName } from '@/features/crm/speaker-rows'

export type MergeSpeakersDialogProps = {
  open: boolean
  /** The ticked rows, in table order. Two or more; the button that opens this enforces it. */
  rows: readonly SpeakerRow[]
  primaryId: string
  onPrimaryChange: (id: string) => void
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function MergeSpeakersDialog({
  open,
  rows,
  primaryId,
  onPrimaryChange,
  pending,
  onCancel,
  onConfirm,
}: MergeSpeakersDialogProps) {
  const primary = rows.find((row) => row.speaker.id === primaryId)
  const absorbed = rows.filter((row) => row.speaker.id !== primaryId)

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Merge ${rows.length} speaker records?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {primary === undefined
              ? 'Choose which record to keep.'
              : mergeSummary(
                  speakerName(primary.speaker),
                  absorbed.map((row) => speakerName(row.speaker)),
                )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Keep this record</p>
          {/* Scrolled rather than clipped: `MERGE_MAX_RECORDS` allows ten, and a dialog that
              hides the tenth behind an overflow would hide a record about to be deleted. */}
          <ScrollPanel className="max-h-64">
            <RadioGroup
              value={primaryId}
              disabled={pending}
              onValueChange={(next: unknown) => {
                if (typeof next === 'string') onPrimaryChange(next)
              }}
            >
              {rows.map((row) => (
                <Label
                  key={row.speaker.id}
                  className="items-start gap-3 rounded-md border border-border p-3 font-normal"
                >
                  <RadioGroupItem value={row.speaker.id} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{speakerName(row.speaker)}</span>
                    <span className="text-xs text-muted-foreground">{row.speaker.email}</span>
                    {/* The two counts are what actually distinguishes two records for one
                        person: the one on more events and more sessions is usually the one
                        with the history worth keeping the id of. */}
                    <span className="text-xs text-muted-foreground">
                      {`${row.eventCount} events, ${row.sessionCount} sessions, ${row.tags.length} tags`}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </ScrollPanel>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || primary === undefined}
            onClick={onConfirm}
          >
            {`Merge and delete ${absorbed.length}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
