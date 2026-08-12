'use client'

// The option list of a Dropdown, Multi-Select or Radio question.
//
// Value and label are both editable, and separately, because they are different things: the
// label is what the speaker reads and the value is what gets stored and what a condition or
// a routing rule matches on. Renaming a Track label must not silently break the rule that
// files its submissions.
//
// Adding an option fills the value from the label, since typing the same string twice is
// how an organizer ends up with an option whose value is empty.

import { PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FieldOption } from '@/types/forms'

export type OptionsEditorProps = {
  options: readonly FieldOption[]
  onChange: (options: readonly FieldOption[]) => void
}

export function OptionsEditor({ options, onChange }: OptionsEditorProps) {
  function patch(index: number, next: Partial<FieldOption>): void {
    onChange(options.map((option, at) => (at === index ? { ...option, ...next } : option)))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Options</Label>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...options, { value: '', label: '' }])}
        >
          <PlusIcon />
          Add option
        </Button>
      </div>

      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          A choice question with no options cannot be answered.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {options.map((option, index) => (
            <li key={`${String(index)}-${option.value}`} className="flex items-center gap-1.5">
              <Input
                value={option.label}
                placeholder="Label"
                aria-label={`Option ${String(index + 1)} label`}
                onChange={(event) => {
                  const label = event.target.value
                  // The value follows the label only while it has not been set by hand, so
                  // editing a published option's wording never moves what it stores.
                  patch(index, option.value.length === 0 ? { label, value: label } : { label })
                }}
              />
              <Input
                value={option.value}
                placeholder="Stored value"
                aria-label={`Option ${String(index + 1)} value`}
                onChange={(event) => patch(index, { value: event.target.value })}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onChange(options.filter((_, at) => at !== index))}
              >
                <XIcon />
                <span className="sr-only">{`Remove option ${String(index + 1)}`}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
