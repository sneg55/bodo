'use client'

// "Cross-field character limits" on step 6 (parity ref 14), the authoring half of
// `Forms.crossFieldLimitsJson`.
//
// The stored shape and the enforcement already existed: the public wizard sums the named
// fields and refuses to advance when the combined length is over the cap, and a
// `perParticipant` rule is measured inside each participant's own answers
// (`validateCrossFieldLimits`, `wizard-gating.ts`). What was missing was any way to write one
// without editing the Airtable base by hand, which is what this card is.
//
// A rule's scope is a CHOICE here rather than something derived from the fields picked,
// because it is what decides where the wizard looks: a per-participant rule can only span
// participant questions, so mixing the two lists in one picker would author a rule that sums
// nothing. `checkCrossFieldLimits` rejects that shape for the same reason.

import { PlusIcon, XIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FormDraft } from '@/features/forms/builder/draft'
import { limitableFields } from '@/features/forms/builder/field-ops'
import type { CrossFieldLimit, FormField } from '@/types/forms'

/** Ref 14's two lines, verbatim. */
const CARD_COPY =
  'Cap the combined length of several text fields (for example a printed program block). Submitters see a live combined counter; speaker-field rules apply to each participant.'

const SCOPES: readonly { value: string; label: string }[] = [
  { value: 'submission', label: 'Submission questions' },
  { value: 'participant', label: 'Participant questions' },
]

export type CrossFieldLimitsCardProps = {
  draft: FormDraft
  patch: (next: Partial<FormDraft>) => void
}

export function CrossFieldLimitsCard({ draft, patch }: CrossFieldLimitsCardProps) {
  const abstract = limitableFields(draft.fields)
  // The participant questions are offered whether or not the step is switched on, because
  // they are still in the draft and `toFormWrite` still stores them. Hiding them would make
  // an existing per-participant rule render as a rule over no questions, which reads as
  // broken rather than as inert.
  const participant = limitableFields(draft.participantFields)
  const rules = draft.crossFieldLimits

  function setRules(next: readonly CrossFieldLimit[]): void {
    patch({ crossFieldLimits: next })
  }

  function add(): void {
    // Seeded with the first two eligible questions and a cap equal to what they already
    // allow between them, so a new rule starts as a no-op the organizer tightens rather
    // than as one that instantly fails a form somebody is filling in.
    const seed = (abstract.length >= 2 ? abstract : participant).slice(0, 2)
    setRules([
      ...rules,
      {
        fieldIds: seed.map((field) => field.id),
        maxLen: seed.reduce((total, field) => total + (field.maxLen ?? 255), 0),
        perParticipant: abstract.length < 2,
      },
    ])
  }

  const canAdd = abstract.length >= 2 || participant.length >= 2

  return (
    <Card className="gap-3 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Cross-field character limits</h3>
        <Button variant="outline" size="sm" disabled={!canAdd} onClick={add}>
          <PlusIcon />
          Add rule
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{CARD_COPY}</p>

      {canAdd ? null : (
        <p className="text-xs text-muted-foreground">
          A combined limit needs at least two text questions on one step.
        </p>
      )}

      {rules.map((rule, index) => (
        <LimitRow
          // Position is the identity: a rule has no id, and two rules over the same
          // fields are a thing an organizer can legitimately write while editing.
          key={`limit-${String(index)}`}
          rule={rule}
          index={index}
          abstract={abstract}
          participant={participant}
          onPatch={(next) =>
            setRules(rules.map((entry, at) => (at === index ? { ...entry, ...next } : entry)))
          }
          onRemove={() => setRules(rules.filter((_, at) => at !== index))}
        />
      ))}
    </Card>
  )
}

type LimitRowProps = {
  rule: CrossFieldLimit
  index: number
  abstract: readonly FormField[]
  participant: readonly FormField[]
  onPatch: (next: Partial<CrossFieldLimit>) => void
  onRemove: () => void
}

function LimitRow({ rule, index, abstract, participant, onPatch, onRemove }: LimitRowProps) {
  const choices = rule.perParticipant ? participant : abstract
  const selected = choices.filter((field) => rule.fieldIds.includes(field.id))

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          value={rule.perParticipant ? 'participant' : 'submission'}
          // `items` is required: without it the closed trigger shows the raw stored value
          // instead of the label. That bug has shipped three times here.
          items={SCOPES}
          onValueChange={(next: string | null) => {
            // The chosen fields belong to the old scope, so switching clears them rather
            // than keeping ids the new scope's wizard step would never find.
            if (next !== null) onPatch({ perParticipant: next === 'participant', fieldIds: [] })
          }}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Scope" />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map((scope) => (
              <SelectItem key={scope.value} value={scope.value}>
                {scope.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <FieldPicker
          index={index}
          choices={choices}
          selectedIds={rule.fieldIds}
          onToggle={(fieldId, on) =>
            onPatch({
              fieldIds: on
                ? [...rule.fieldIds, fieldId]
                : rule.fieldIds.filter((id) => id !== fieldId),
            })
          }
        />

        <span className="text-xs text-muted-foreground">share</span>
        <Input
          type="number"
          min={1}
          className="w-28"
          aria-label={`Combined character limit for rule ${String(index + 1)}`}
          value={String(rule.maxLen)}
          onChange={(event) => onPatch({ maxLen: Number(event.target.value) })}
        />
        <span className="text-xs text-muted-foreground">characters</span>

        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onRemove}>
          <XIcon />
          <span className="sr-only">{`Remove rule ${String(index + 1)}`}</span>
        </Button>
      </div>

      {selected.length === 0 ? null : (
        <div className="flex flex-wrap gap-1">
          {selected.map((field) => (
            <Badge key={field.id} variant="secondary">
              {field.label}
            </Badge>
          ))}
        </div>
      )}

      {/* Said here as well as by `checkCrossFieldLimits` on save, because a one-field rule
          looks finished: the row is complete and the cap is set. */}
      {selected.length < 2 ? (
        <p className="text-xs text-destructive">Choose at least two questions for this rule.</p>
      ) : null}
    </div>
  )
}

type FieldPickerProps = {
  index: number
  choices: readonly FormField[]
  selectedIds: readonly string[]
  onToggle: (fieldId: string, on: boolean) => void
}

/** Popover + Command + Checkbox, the same multi-select idiom the column picker uses. */
function FieldPicker({ index, choices, selectedIds, onToggle }: FieldPickerProps) {
  const count = choices.filter((field) => selectedIds.includes(field.id)).length

  return (
    <Popover>
      {/* The label is the TRIGGER's children, not the rendered Button's: base-ui merges
          them into the render element, and children on the element are dropped. */}
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={choices.length === 0}
            aria-label={`Questions in rule ${String(index + 1)}`}
          />
        }
      >
        {count === 0 ? 'Choose questions' : `${String(count)} selected`}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search fields..." />
          <CommandList>
            <CommandEmpty>No text questions found.</CommandEmpty>
            {choices.map((field) => {
              const on = selectedIds.includes(field.id)
              return (
                <CommandItem
                  key={field.id}
                  value={field.label}
                  onSelect={() => onToggle(field.id, !on)}
                >
                  {/* Visual only: the row owns the toggle, so a handler here would fire
                      twice and cancel itself out. */}
                  <Checkbox checked={on} tabIndex={-1} className="pointer-events-none" />
                  <span className="truncate">{field.label}</span>
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
