'use client'

// Steps 3 and 4: the question list (parity refs 08-11). One component for both, because
// the row anatomy, the "+ Add Field" flow and the reorder behaviour are identical and the
// parity doc transcribes them as one pattern. What differs is the intro line, which
// registry the picker draws from, and the two cards that only belong to one of them: the
// participant roles panel on step 4 and category routing on step 3.
//
// "Section Title", "Page Heading" and "Description & Instructions" open both steps, in their
// own card above the questions, and bind to the per-step columns through `SectionHeadingFields`.
// The public wizard renders all three: the section title is the step's heading, the page
// heading is its rail label, and the description is the block above the questions.

import { nanoid } from 'nanoid'
import { useState } from 'react'

import { Card } from '@/components/ui/card'
import { PARTICIPANT_FIELDS, SESSION_FIELDS } from '@/constants/fields'
import {
  addQuestion,
  moveQuestion,
  patchQuestion,
  removeQuestion,
  reorderQuestions,
} from '@/features/forms/builder/draft-edits'
import type { FormField } from '@/types/forms'

import { AddFieldMenu } from './AddFieldMenu'
import type { StepProps } from './EditorStepBody'
import { FieldEditorSheet } from './FieldEditorSheet'
import { FieldList } from './FieldList'
import { SectionHeadingFields } from './HeadingFields'
import { RolesPanel } from './RolesPanel'
import { RoutingCard } from './RoutingCard'

const INTRO: ReadonlyMap<string, string> = new Map([
  ['abstract', 'Collect information about submitted abstracts.'],
  [
    'participant',
    'Collect information for participants and the primary contact for this submission.',
  ],
])

export type StepQuestionsProps = StepProps & { kind: 'abstract' | 'participant' }

export function StepQuestions({
  eventId,
  draft,
  patch,
  trackOptions,
  tagOptions,
  kind,
}: StepQuestionsProps) {
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const participant = kind === 'participant'
  const fields = participant ? draft.participantFields : draft.fields

  // Every one of these goes through the UPDATER form, so the edit is computed from the draft
  // as it is when the update runs rather than from the copy this render was given. Two edits
  // in one task used to overwrite each other, which is how a question could vanish between
  // being added and being saved. See the header of `draft-edits.ts`.
  function add(field: FormField): void {
    patch((current) => addQuestion(current, kind, field))
    setEditingId(field.id)
  }

  function remove(id: string): void {
    patch((current) => removeQuestion(current, kind, id))
    if (editingId === id) setEditingId(undefined)
  }

  const editing = fields.find((field) => field.id === editingId)

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3 px-4 py-3">
        <SectionHeadingFields draft={draft} patch={patch} kind={kind} />
      </Card>

      <p className="text-sm text-muted-foreground">{INTRO.get(kind)}</p>

      {participant ? (
        <RolesPanel roles={draft.roles} onChange={(roles) => patch({ roles })} />
      ) : null}

      <Card className="gap-3 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Form Questions</h3>
          <AddFieldMenu
            registry={participant ? PARTICIPANT_FIELDS : SESSION_FIELDS}
            used={fields}
            onAdd={add}
            newId={() => nanoid(10)}
          />
        </div>

        <FieldList
          fields={fields}
          onReorder={(activeId, overId) =>
            patch((current) => reorderQuestions(current, kind, activeId, overId))
          }
          onMove={(id, delta) => patch((current) => moveQuestion(current, kind, id, delta))}
          onEdit={setEditingId}
          onRemove={remove}
          onRequiredChange={(id, required) =>
            patch((current) => patchQuestion(current, kind, id, { required }))
          }
        />
      </Card>

      {participant ? null : (
        <RoutingCard
          fields={draft.fields}
          routing={draft.routing}
          trackOptions={trackOptions}
          onChange={(routing) => patch({ routing })}
        />
      )}

      <FieldEditorSheet
        field={editing}
        fields={fields}
        event={{ id: eventId, categories: { trackOptions, tagOptions } }}
        onClose={() => setEditingId(undefined)}
        onChange={(patchedField) => {
          const id = editing?.id
          if (id !== undefined) patch((current) => patchQuestion(current, kind, id, patchedField))
        }}
      />
    </div>
  )
}
