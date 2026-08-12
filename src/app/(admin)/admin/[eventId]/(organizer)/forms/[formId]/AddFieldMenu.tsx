'use client'

// "+ Add Field" (parity refs 08, 11). What it opens is one of the parity doc's open
// questions, so this is a decision: a two-group menu, the field library first and a bare
// type picker second.
//
// The library comes first on purpose. A library field carries a `registryKey`, which is the
// only thing that routes its answer into a typed Airtable column; the same question added
// as a bare type looks identical on the row and lands in `answersJson`, where the Abstracts
// table cannot sort or filter on it. A picker that made the two equally reachable would
// make the wrong one the default.
//
// Fields already on the form are hidden from the library group rather than shown disabled:
// two Title questions would both claim the title column.

import { PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { RegistryField } from '@/constants/fields'
import { fieldFromRegistry, fieldFromType } from '@/features/forms/builder/field-ops'
import { FIELD_TYPE_LABELS, type FieldType, type FormField } from '@/types/forms'

/** Read through a Map, since indexing a Record with a variable is a lint error. */
const TYPE_LABELS: ReadonlyMap<FieldType, string> = new Map(
  Object.entries(FIELD_TYPE_LABELS).map(([type, label]) => [type as FieldType, label]),
)

/**
 * The types the parity doc observed on real rows (Text, Wysiwyg, Dropdown, Email, Phone),
 * plus the ones `FieldControl` renders that an organizer visibly needs. Not every member of
 * `FIELD_TYPES`: `speaker_bio` and `speaker_headshot` write through to a Speakers record
 * and belong to the library rather than to a free-form picker.
 */
const OFFERED_TYPES: readonly FieldType[] = [
  'text',
  'wysiwyg',
  'select',
  'multiselect',
  'radio',
  'checkbox',
  'email',
  'phone',
  'url',
  'video',
  'number',
  'datetime',
]

export type AddFieldMenuProps = {
  registry: readonly RegistryField[]
  used: readonly FormField[]
  onAdd: (field: FormField) => void
  newId: () => string
}

export function AddFieldMenu({ registry, used, onAdd, newId }: AddFieldMenuProps) {
  const taken = new Set(used.map((field) => field.registryKey))
  // Only the fields a form can actually collect. The app assigns `code`, `status`,
  // `source` and the scheduling columns, so a question claiming one of them would write an
  // answer nowhere (see `splitAnswers`).
  const available = registry.filter(
    (field) => !taken.has(field.key) && COLLECTABLE_KEYS.has(field.key),
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon />
        Add Field
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {available.length === 0 ? null : (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>From the field library</DropdownMenuLabel>
              {available.map((field) => (
                <DropdownMenuItem
                  key={field.key}
                  onClick={() => onAdd(fieldFromRegistry(field, newId()))}
                >
                  {field.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>New question</DropdownMenuLabel>
          {OFFERED_TYPES.map((type) => (
            <DropdownMenuItem key={type} onClick={() => onAdd(fieldFromType(type, newId()))}>
              {TYPE_LABELS.get(type)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Registry keys a submitter may answer. The rest are set by the app, and
 * `COLUMN_BY_REGISTRY_KEY` in `answer-storage` is the authority on which is which: a key
 * that is a column there is answerable, and the four blob-backed ones are listed by hand
 * because they have no column entry.
 */
const COLLECTABLE_KEYS: ReadonlySet<string> = new Set([
  'title',
  'description',
  'format',
  'level',
  'language',
  'track',
  'tags',
  'ceuCredits',
  'firstName',
  'lastName',
  'email',
  'phone',
  'bio',
  'company',
  'headshot',
])
