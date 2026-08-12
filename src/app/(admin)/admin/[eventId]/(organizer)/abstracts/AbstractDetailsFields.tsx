'use client'

// The Details tab of the Add Abstract drawer.
//
// Every label, placeholder and the 0/255 counter come from docs/parity/abstracts-review.md
// ref 23, verbatim. One documented deviation:
//
//   - Description is still a Textarea, not a rich text editor. The `RichTextEditor`
//     primitive now exists, so this is a promotion waiting on the read side rather than on
//     the primitive: the description an organizer types here is what the abstracts table's
//     Description column and the CSV export both render, and neither renders markup. The
//     placeholder copy is already the parity one.
//
// Starts At and Ends At were `Input type="datetime-local"` while the shared date-time
// control did not exist. It does: `DateTimeField` is the Calendar-in-a-Popover that Event
// Details and the evaluation plan editor both use, so this tab uses it too and stores an
// ISO instant resolved in the event's zone rather than a naked wall clock.

import { DateTimeField } from '@/components/primitives/DateTimeField'
import { StatusChip } from '@/components/primitives/StatusChipBadge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { SubmissionStatus } from '@/constants/status'
import { SESSION_FORMATS } from '@/constants/vocabularies'

import { type AbstractDraft, START_STATUSES, TITLE_MAX } from './add-abstract-draft'
import { LabeledInput } from './LabeledInput'

export type AbstractDetailsFieldsProps = {
  draft: AbstractDraft
  /** The event's own zone, which is what a typed Starts At and Ends At mean. */
  timeZone: string
  onChange: <K extends keyof AbstractDraft>(key: K, value: AbstractDraft[K]) => void
}

export function AbstractDetailsFields({ draft, timeZone, onChange }: AbstractDetailsFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="abstract-title">
            Title <span className="text-destructive">*</span>
          </Label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {draft.title.length}/{TITLE_MAX}
          </span>
        </div>
        <Input
          id="abstract-title"
          value={draft.title}
          maxLength={TITLE_MAX}
          placeholder="Enter abstract title..."
          onChange={(event) => onChange('title', event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Status</Label>
        <Select
          // The chip, not the bare status, so the closed trigger matches the open list.
          // Without `items` Base UI printed the raw value and this read `pending` in lower
          // case next to a list of proper status chips.
          items={Object.fromEntries(
            START_STATUSES.map((status) => [status, <StatusChip key={status} status={status} />]),
          )}
          value={draft.status}
          onValueChange={(next: SubmissionStatus | null) => {
            if (next !== null) onChange('status', next)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {START_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                <StatusChip status={status} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="abstract-description">Description</Label>
        <Textarea
          id="abstract-description"
          value={draft.description}
          rows={5}
          placeholder="Enter description..."
          onChange={(event) => onChange('description', event.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="abstract-starts">Starts At</Label>
          <DateTimeField
            id="abstract-starts"
            value={draft.startsAt === '' ? undefined : draft.startsAt}
            timeZone={timeZone}
            onChange={(value) => onChange('startsAt', value ?? '')}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="abstract-ends">Ends At</Label>
          <DateTimeField
            id="abstract-ends"
            value={draft.endsAt === '' ? undefined : draft.endsAt}
            timeZone={timeZone}
            onChange={(value) => onChange('endsAt', value ?? '')}
          />
        </div>
        <LabeledInput
          id="abstract-capacity"
          label="Capacity"
          placeholder="Number of attendees"
          value={draft.capacity}
          onChange={(value) => onChange('capacity', value)}
        />
        <LabeledInput
          id="abstract-ceu"
          label="CEU Credits"
          placeholder="Enter CEU credits"
          value={draft.ceuCredits}
          onChange={(value) => onChange('ceuCredits', value)}
        />
        <LabeledInput
          id="abstract-client"
          label="Client ID"
          placeholder="Enter client ID"
          value={draft.clientSessionId}
          onChange={(value) => onChange('clientSessionId', value)}
        />
        {/* A SELECT, and it has to be.

            This was a free-text box whose placeholder read "Select format...", and
            `Submissions.format` is an Airtable single-select. Airtable refuses a write of a
            choice that is not already declared, and this project's token cannot create one,
            so anything typed here that was not one of the five values answered 422 and
            rejected the WHOLE record: the sheet stayed open with the title, the description
            and every participant still in it, and the only way forward was to clear the
            field. vocabularies.ts opens with this exact failure mode. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="abstract-format">Format</Label>
          <Select
            items={Object.fromEntries(
              SESSION_FORMATS.map((choice) => [choice.value, choice.label]),
            )}
            value={draft.format === '' ? null : draft.format}
            onValueChange={(next: string | null) => {
              onChange('format', next ?? '')
            }}
          >
            <SelectTrigger id="abstract-format" className="w-full">
              <SelectValue placeholder="Select format..." />
            </SelectTrigger>
            <SelectContent>
              {SESSION_FORMATS.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  )
}
