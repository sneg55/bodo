'use client'

// Step 1, Submission Setup (parity ref 06). Structural: the choice here changes step 3's
// vocabulary, and the Participants toggle adds or removes step 4 entirely.
//
// The two cards are a RadioGroup rather than two buttons, per the component map: radio
// cards are what `RadioGroup` is for, and the choice is single-select and mutually
// exclusive.

import { InfoIcon, UsersIcon } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import type { FormEntityKind } from '@/constants/status'
import { cn } from '@/utils/cn'

import type { StepProps } from './EditorStepBody'

const KINDS: readonly { value: FormEntityKind; title: string; body: string }[] = [
  {
    value: 'abstracts',
    title: 'Abstracts',
    body: 'Collect abstract submissions for review before sessions are finalized.',
  },
  {
    value: 'sessions',
    title: 'Sessions',
    body: 'Collect full session proposals with details for your program.',
  },
]

export function StepSetup({ draft, patch }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">What kind of submissions do you want to collect?</h3>
        <p className="text-sm text-muted-foreground">
          Choose what submitters will send and whether to collect participant details.
        </p>
      </div>

      <Card className="flex-row items-center gap-2 px-4 py-3 text-sm">
        <InfoIcon className="size-4 shrink-0 text-muted-foreground" />
        <span>You can adjust these choices later by editing this form.</span>
      </Card>

      <RadioGroup
        value={draft.entityKind}
        onValueChange={(next: unknown) => {
          if (next === 'abstracts' || next === 'sessions') patch({ entityKind: next })
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        {KINDS.map((kind) => (
          <Card
            key={kind.value}
            // Padding moves off the Card and onto the Label below, so the label COVERS the
            // padding too. A card whose label stops at the text leaves an inert border of
            // dead space around a target that is meant to read as one tile.
            className={cn('gap-0 p-0', draft.entityKind === kind.value && 'ring-2 ring-primary')}
          >
            {/* The WHOLE tile is the label, not just the title beside the dot.
                The card is drawn as a selectable surface, so the title, the description and
                the padding all have to select it; before this, only the 16px dot and the
                one word next to it did. This was the last radio card in the product still
                doing that: `AddTaskSheet`, `AddFileRequestSheet` and `StepFormSetup` all
                already wrap their whole tile, and this now matches them.

                Wrapping rather than `htmlFor`, for the same reason they do: a control
                nested in a label is its labelled control, so there is no id to keep in sync
                and the label activates it natively. An `onClick` on the container would be
                a mouse-only affordance, and a lint error besides. */}
            <Label className="flex cursor-pointer flex-col items-start gap-1 px-4 py-3 font-normal">
              <span className="flex items-center gap-2 font-medium">
                <RadioGroupItem value={kind.value} />
                {kind.title}
              </span>
              <span className="text-xs text-muted-foreground">{kind.body}</span>
            </Label>
          </Card>
        ))}
      </RadioGroup>

      <Card className="flex-row items-center gap-3 px-4 py-3">
        <UsersIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-col">
          <Label htmlFor="participants-enabled" className="font-medium">
            Participants
          </Label>
          <span className="text-xs text-muted-foreground">
            Include a step to collect speaker and participant contact information.
          </span>
        </span>
        <Switch
          id="participants-enabled"
          className="ml-auto"
          checked={draft.participantsEnabled}
          onCheckedChange={(checked) => patch({ participantsEnabled: checked })}
        />
      </Card>
    </div>
  )
}
