'use client'

// Step 2, Form Questions (ref 28).
//
// Nothing here is new machinery. The add-field popover, the row anatomy, the drag reorder and
// the per-field drawer are the CFP editor's `AddFieldMenu`, `FieldList` and `FieldEditorSheet`,
// imported rather than copied: ref 28's field picker and its `Title / Text / Required / lock /
// kebab` row are the same controls as refs 08-11, and a second implementation of them would
// drift on the part that is expensive to see, which is what a `showIf` is allowed to point at.
//
// `Section Title` is transcribed on ref 28 and is not here, for the reason `StepFormSetup`
// gives about the public `Title`: `Forms` has no column for it, so the control would store
// nothing. `Description & Instructions` IS here, because `welcomeHtml` holds it.
//
// Which registry the picker draws from follows the form's Type. Ref 28 is a Submissions form and
// its picker lists session fields (`Client Session ID`, `Description`, `Format`, `Language`,
// `Level`, `Tags`), so a Contacts form gets the participant set instead. The `registryKey` a
// library field carries is INERT on a portal form, because a portal answer goes to
// `TaskAssignments.answersJson` and `splitAnswers` is never called on it. It is carried through
// anyway rather than stripped, because it is what `AddFieldMenu` uses to stop the same library
// field being added twice, and a duplicated question is a real problem where an unused property
// is not.

import { nanoid } from 'nanoid'
import { useState } from 'react'

import { RichTextEditor } from '@/components/primitives/RichTextEditor'
import { Card } from '@/components/ui/card'
import { PARTICIPANT_FIELDS, SESSION_FIELDS } from '@/constants/fields'
import type { FormDraft } from '@/features/forms/builder/draft'
import {
  addQuestion,
  type DraftPatch,
  moveQuestion,
  patchQuestion,
  removeQuestion,
  reorderQuestions,
} from '@/features/forms/builder/draft-edits'
import type { FormField } from '@/types/forms'

import { AddFieldMenu } from '../forms/[formId]/AddFieldMenu'
import { FieldEditorSheet } from '../forms/[formId]/FieldEditorSheet'
import { FieldList } from '../forms/[formId]/FieldList'

export type StepFormQuestionsProps = {
  draft: FormDraft
  patch: (next: DraftPatch) => void
}

export function StepFormQuestions({ draft, patch }: StepFormQuestionsProps) {
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const fields = draft.fields

  // Every edit goes through the UPDATER form, so it is computed from the draft as it is when
  // the update runs rather than from the copy this render was given: two edits dispatched in
  // one task used to overwrite each other, and the question that lost is simply gone. See the
  // header of `draft-edits.ts`. The `abstract` kind is the one question list a portal form
  // has; the routing prune that comes with `removeQuestion` is a no-op here, because this
  // surface has no routing and never authors a rule.
  function add(field: FormField): void {
    patch((current) => addQuestion(current, 'abstract', field))
    setEditingId(field.id)
  }

  function remove(id: string): void {
    patch((current) => removeQuestion(current, 'abstract', id))
    if (editingId === id) setEditingId(undefined)
  }

  const editing = fields.find((field) => field.id === editingId)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Form Questions</h3>
        <p className="text-sm text-muted-foreground">
          Add and arrange the fields participants will fill out.
        </p>
      </div>

      <Card className="gap-3 px-4 py-3">
        <RichTextEditor
          id="portal-form-welcome"
          label="Description & Instructions"
          value={draft.welcomeHtml}
          placeholder="Enter instructions..."
          help="Shown above the questions when a speaker opens this form in their portal."
          onChange={(html) => patch({ welcomeHtml: html, welcomeEnabled: true })}
        />
      </Card>

      <Card className="gap-3 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Form Questions</h3>
          <AddFieldMenu
            registry={draft.entityType === 'submission' ? SESSION_FIELDS : PARTICIPANT_FIELDS}
            used={fields}
            onAdd={add}
            newId={() => nanoid(10)}
          />
        </div>

        <FieldList
          fields={fields}
          onReorder={(activeId, overId) =>
            patch((current) => reorderQuestions(current, 'abstract', activeId, overId))
          }
          onMove={(id, delta) => patch((current) => moveQuestion(current, 'abstract', id, delta))}
          onEdit={setEditingId}
          onRemove={remove}
          onRequiredChange={(id, required) =>
            patch((current) => patchQuestion(current, 'abstract', id, { required }))
          }
        />
      </Card>

      <FieldEditorSheet
        field={editing}
        fields={fields}
        onClose={() => setEditingId(undefined)}
        onChange={(patchedField) => {
          const id = editing?.id
          if (id !== undefined)
            patch((current) => patchQuestion(current, 'abstract', id, patchedField))
        }}
      />
    </div>
  )
}
