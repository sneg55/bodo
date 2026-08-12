'use client'

// The Participants tab of the Add Abstract drawer, below the primary speaker.
//
// Ref 23 shows the tab but not its contents, which docs/parity/abstracts-review.md records
// as an open question, so the shape here is bodo's: the same three fields the primary
// speaker has, in a bordered block per person, numbered from 2 because the drawer's own
// first block is participant 1.
//
// Split out of AddAbstractSheet.tsx rather than nested in it because that file is the
// drawer's markup and this is a list with its own row identity; the state and the rules
// both live in add-abstract-draft.ts, so nothing here decides anything.

import { XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

import {
  blankExtraParticipant,
  type ExtraParticipant,
  removeExtraParticipant,
  setExtraField,
} from './add-abstract-draft'
import { LabeledInput } from './LabeledInput'

export type AbstractParticipantRowsProps = {
  extras: readonly ExtraParticipant[]
  onChange: (extras: readonly ExtraParticipant[]) => void
}

export function AbstractParticipantRows({ extras, onChange }: AbstractParticipantRowsProps) {
  return (
    <>
      {extras.map((entry, index) => (
        <div key={entry.key} className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{`Participant ${String(index + 2)}`}</p>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove participant"
              onClick={() => {
                onChange(removeExtraParticipant(extras, entry.key))
              }}
            >
              <XIcon />
            </Button>
          </div>
          <LabeledInput
            id={`abstract-email-${entry.key}`}
            label="Email"
            required
            placeholder="name@example.com"
            value={entry.email}
            onChange={(value) => onChange(setExtraField(extras, entry.key, 'email', value))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledInput
              id={`abstract-first-${entry.key}`}
              label="First Name"
              value={entry.firstName}
              onChange={(value) => onChange(setExtraField(extras, entry.key, 'firstName', value))}
            />
            <LabeledInput
              id={`abstract-last-${entry.key}`}
              label="Last Name"
              value={entry.lastName}
              onChange={(value) => onChange(setExtraField(extras, entry.key, 'lastName', value))}
            />
          </div>
        </div>
      ))}

      <Button
        variant="outline"
        className="self-start"
        onClick={() => {
          onChange([...extras, blankExtraParticipant()])
        }}
      >
        + Add Participant
      </Button>
    </>
  )
}
