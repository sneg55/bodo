'use client'

// The submission body, editable. BUILD_SPEC 5.2's first two modes render this; the third
// renders `SubmissionAnswers` instead, read-only, because the section says a frozen body is
// read-only rather than merely disabled.
//
// The questions come from the form and are rendered by the same `FieldControl` the public
// wizard uses, so a speaker revising an abstract meets the control they filled in the first
// time: same counters, same placeholders, same conditional visibility, evaluated by the
// same `visibleFields` the server re-runs on save.
//
// The answers are posted as one JSON value rather than as named inputs. A multiselect
// answer is an array and a checkbox answer is a boolean (see FieldControl's header), and
// form encoding flattens both into strings that the server's shape checks then reject.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { FieldControl } from '@/features/forms/FieldControl'
import { answerIndex, type FormAnswers, visibleFields } from '@/features/forms/logic'
import { saveSubmissionBodyAction } from '@/features/portal/actions'
import type { FormField } from '@/types/forms'

export type SubmissionBodyFormProps = {
  code: string
  fields: readonly FormField[]
  /** The stored answers, reassembled from both halves of storage by `answersForForm`. */
  answers: FormAnswers
}

export function SubmissionBodyForm({ code, fields, answers }: SubmissionBodyFormProps) {
  const [draft, setDraft] = useState<FormAnswers>(answers)
  const [pending, startTransition] = useTransition()

  const visible = visibleFields(fields, draft)
  // Read through a Map, never `draft[field.id]`: a dynamic index on a plain object also
  // reaches inherited keys, so a field whose id collided with a prototype member would
  // render an "answer" nobody typed.
  const current = answerIndex(draft)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData()
    formData.set('code', code)
    formData.set('answers', JSON.stringify(draft))
    startTransition(async () => {
      const result = await saveSubmissionBodyAction(formData)
      // `Saved successfully` is the toast the parity docs record for a save elsewhere in
      // the product, and the profile form already uses it. One phrasing, not two.
      if (result.ok) toast.success('Saved successfully', { description: result.message })
      else toast.error(result.message)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Questions marked with an asterisk are required.
      </p>

      {visible.map((field) => (
        <FieldControl
          key={field.id}
          field={field}
          value={current.get(field.id)}
          disabled={pending}
          onChange={(value) => {
            setDraft((previous) => ({ ...previous, [field.id]: value }))
          }}
        />
      ))}

      <div className="flex justify-end">
        {/* 32px, with the last question 20px above it across the form's `gap-5`. */}
        <Button type="submit" className="hit-area-y" disabled={pending}>
          {pending ? 'Saving' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
