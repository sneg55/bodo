'use client'

// The `Add File Request` drawer, transcribed off ref 31.
//
// This one is captured, so the copy here is the product's and not an interpretation: the title,
// the subtitle, the info callout, the `Title` placeholder, the three type cards with `Contacts`
// preselected and `Groups` dimmed, the `Instructions` editor with its placeholder, and the
// footer of `Cancel` plus `Create File Request` disabled until valid. All of it lives in
// request-draft.ts where it can be asserted; this file is the markup.
//
// `Required`, `Due date` and `Request from accepted speakers` are additions, and they are
// marked as such in request-draft.ts rather than presented as parity. The due date control
// is `DueDateField` next door, which records why it is no longer a native date input.

import { InfoIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { DateKeyField } from '@/components/primitives/DateKeyField'
import { RichTextEditor } from '@/components/primitives/RichTextEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { TaskEntityType } from '@/constants/status'
import { createFileRequestAction } from '@/features/file-requests/actions'
import {
  assignSummary,
  EMPTY_REQUEST_DRAFT,
  INFO_CALLOUT,
  isRequestDraftValid,
  REQUEST_TITLE_MAX,
  REQUEST_TYPE_CARDS,
  type RequestDraft,
  toCreateRequestInput,
} from '@/features/file-requests/request-draft'
import { cn } from '@/utils/cn'

import { TaskTypeIcon } from '../tasks/TaskTypeIcon'

export type AddFileRequestSheetProps = {
  eventId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** How many people the switch below would fan this out to, named on the control itself. */
  acceptedSpeakers: number
}

export function AddFileRequestSheet({
  eventId,
  open,
  onOpenChange,
  acceptedSpeakers,
}: AddFileRequestSheetProps) {
  const [draft, setDraft] = useState<RequestDraft>(EMPTY_REQUEST_DRAFT)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const set = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const submit = () => {
    startTransition(async () => {
      const result = await createFileRequestAction(toCreateRequestInput(eventId, draft))
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // Says who it reached, because that is the fact the organizer cannot otherwise check
      // without opening the new card and reading its counter.
      toast.success('Saved successfully', { description: assignSummary(result.assigned) })
      setDraft(EMPTY_REQUEST_DRAFT)
      onOpenChange(false)
      // The action expired the tags; this is what gets this browser to ask again, so the new
      // card shows its real counter rather than the list it was rendered from.
      router.refresh()
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg!">
        <SheetHeader>
          <SheetTitle>Add File Request</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Create a new file request for participants
          </p>
        </SheetHeader>

        {/* No `min-h-0 flex-1` on this column, and that is load-bearing rather than a style
            tweak: `SheetContent` is the scroller, so a body that is told to fill the
            remaining height gets a clipped box its own children then paint OUTSIDE of, and
            the fields below the editor render straight over the footer. Measured on the
            running app at 1280x720: the footer sat at y 513-577 while the due date field
            painted at y 719. Letting the column take its natural height puts the footer back
            at the end of the scrolled content. `../tasks/AddTaskSheet.tsx` had the same bug and
            carries the same note. */}
        <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{INFO_CALLOUT.heading}</span>
              <span className="text-xs text-muted-foreground">{INFO_CALLOUT.body}</span>
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="request-title">Title</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {draft.title.length}/{REQUEST_TITLE_MAX}
              </span>
            </div>
            <Input
              id="request-title"
              value={draft.title}
              maxLength={REQUEST_TITLE_MAX}
              placeholder="e.g. Upload Presentation Slides"
              onChange={(event) => set('title', event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              Type <span className="text-destructive">*</span>
            </Label>
            <RadioGroup
              value={draft.entityType}
              onValueChange={(next) => set('entityType', next as TaskEntityType)}
            >
              {REQUEST_TYPE_CARDS.map((card) => (
                <Label
                  key={card.entityType}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3',
                    draft.entityType === card.entityType && 'border-primary bg-muted/40',
                  )}
                >
                  <RadioGroupItem value={card.entityType} />
                  <TaskTypeIcon
                    entityType={card.entityType}
                    className="size-4 text-muted-foreground"
                  />
                  <span className="font-medium">{card.label}</span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          <RichTextEditor
            id="request-instructions"
            label="Instructions"
            value={draft.instructionsHtml}
            placeholder="Enter instructions..."
            onChange={(html) => set('instructionsHtml', html)}
          />

          <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Required</span>
              <span className="text-xs text-muted-foreground">
                A required document is counted against a speaker until it arrives.
              </span>
            </span>
            <Switch checked={draft.required} onCheckedChange={(next) => set('required', next)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-due">Due date</Label>
            {/* A DATE and not a date-time, for the same reason the task sheet's is:
                `datetime-local` yields the empty string unless both segments are filled, so
                picking a date and leaving the time alone silently produced no deadline. */}
            <DateKeyField
              id="request-due"
              value={draft.dueAt}
              onChange={(next) => set('dueAt', next)}
              emptyLabel="No due date"
              clearLabel="Clear due date"
            />
            <p className="text-xs text-muted-foreground">
              Due at the end of this day, in the event&apos;s timezone.
            </p>
          </div>

          {/* The last thing before the footer, because it decides whether pressing Create
              does anything for a speaker. Creating used to assign to nobody and say nothing:
              the card read "Not requested from anybody yet" and no portal ever showed it. */}
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Request from accepted speakers</span>
              <span className="text-xs text-muted-foreground">
                {acceptedSpeakers === 0
                  ? 'Nobody is accepted yet, so this will be created without reaching anybody. Use the card menu once speakers are accepted.'
                  : `Sends it to the ${String(acceptedSpeakers)} accepted ${acceptedSpeakers === 1 ? 'speaker' : 'speakers'} as soon as it is created. Off means it reaches nobody until you use the card menu.`}
              </span>
            </span>
            <Switch
              // Off and unusable with nobody accepted, so the control cannot promise a
              // fan-out that would reach zero people.
              checked={draft.requestFromAccepted && acceptedSpeakers > 0}
              disabled={acceptedSpeakers === 0}
              onCheckedChange={(next) => set('requestFromAccepted', next)}
            />
          </div>
        </div>

        <SheetFooter className="flex-row justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!isRequestDraftValid(draft) || pending} onClick={submit}>
            Create File Request
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
