'use client'

// The option list of a question whose options are NOT the form's to invent: Track and Tags,
// whose values are this event's category record ids, and Format, Level and Language, whose
// values are the choices their Airtable single-select column was declared from.
//
// `OptionsEditor` next door is the free-text one, and it was the only one there. That is the
// CFP-01 finding: the checks refused a Track option that was not a record on this event, and
// the only control the organizer had typed the label into the value, so every option they
// could author was refused and the form could not be saved at all. The same control aimed at
// Format produced `value: 'Talk'`, which the single-select cannot hold.
//
// So the value is never typed here. It is picked, and only the LABEL stays editable, because
// an organizer legitimately wants "Talk (30 min)" in front of a speaker while the column
// stores `talk`. Anything already stored that is not on offer is listed at the bottom with a
// Remove button rather than hidden: it is the reason a save is being refused, so it has to be
// visible and fixable in the same place.

import { XIcon } from 'lucide-react'
import Link from 'next/link'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  isStorableOption,
  type OptionSource,
  optionForChoice,
} from '@/features/forms/builder/option-sources'
import type { FieldOption } from '@/types/forms'

export type ConstrainedOptionsEditorProps = {
  source: OptionSource
  options: readonly FieldOption[]
  onChange: (options: readonly FieldOption[]) => void
  /** The Library tab that creates categories, when this event has none yet. */
  libraryHref: string
}

export function ConstrainedOptionsEditor({
  source,
  options,
  onChange,
  libraryHref,
}: ConstrainedOptionsEditorProps) {
  const stale = options.filter((option) => !isStorableOption(source, option.value))

  function toggle(choice: FieldOption, checked: boolean): void {
    const current = optionForChoice(source, options, choice)
    if (checked) {
      if (current !== undefined) return
      onChange([...options, { value: choice.value, label: choice.label }])
      return
    }
    onChange(options.filter((option) => option.value !== current?.value))
  }

  function rename(option: FieldOption, label: string): void {
    onChange(options.map((entry) => (entry.value === option.value ? { ...entry, label } : entry)))
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Options</Label>
      <p className="text-xs text-muted-foreground">{NOTE.get(source.origin)}</p>

      {source.choices.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-4">
          <p className="text-sm">
            This event has no categories yet, so this question has nothing to offer.
          </p>
          <ButtonLink href={libraryHref} variant="outline" size="sm">
            Add categories
          </ButtonLink>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {source.choices.map((choice) => {
            const chosen = optionForChoice(source, options, choice)
            return (
              <li key={choice.value} className="flex items-center gap-2">
                <Checkbox
                  id={`option-${choice.value}`}
                  checked={chosen !== undefined}
                  onCheckedChange={(checked) => toggle(choice, checked === true)}
                />
                <Label htmlFor={`option-${choice.value}`} className="w-32 shrink-0 truncate">
                  {choice.label}
                </Label>
                {chosen === undefined ? null : (
                  <Input
                    value={chosen.label}
                    placeholder={choice.label}
                    aria-label={`Wording shown for ${choice.label}`}
                    onChange={(event) => rename(chosen, event.target.value)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {stale.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-destructive">{STALE_NOTE.get(source.origin)}</p>
          <ul className="flex flex-col gap-1.5">
            {stale.map((option) => (
              <li key={option.value} className="flex items-center gap-2">
                <Badge variant="outline">{option.label || option.value}</Badge>
                <span className="truncate text-xs text-muted-foreground">{option.value}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  onClick={() => onChange(options.filter((entry) => entry.value !== option.value))}
                >
                  <XIcon />
                  <span className="sr-only">{`Remove ${option.label || option.value}`}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Read through a Map, since indexing a Record with a variable is a lint error. */
const NOTE: ReadonlyMap<string, string> = new Map([
  [
    'event',
    "These are this event's own categories. Tick the ones this question offers; the wording beside each one is what the speaker reads.",
  ],
  [
    'vocabulary',
    'These are the values this answer can be stored as. Tick the ones this question offers; the wording beside each one is what the speaker reads.',
  ],
])

const STALE_NOTE: ReadonlyMap<string, string> = new Map([
  [
    'event',
    'These options are not categories on this event, so a save is refused while they are here.',
  ],
  // Says what it costs, because a warning that only names a condition is one an organizer
  // clicks past. It refuses the publish now (`blocksPublish` in builder/problem.ts) rather
  // than only the save, so the sentence has to say so.
  [
    'vocabulary',
    'These options cannot be stored, so an answer of one would be dropped. This form cannot be published while they are here.',
  ],
])
