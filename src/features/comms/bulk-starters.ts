// The email templates offered as a starting point in the bulk composer. SPK-13.
//
// The finding this answers is that Event Settings exposed "only trigger-bound Email
// Templates": an organizer had bodies they had already written and no way to send one to a
// selection of people. This makes those bodies reachable from the composer WITHOUT making the
// composer a second editor for them, which is the distinction that keeps the two surfaces
// honest:
//
//   - Picking a starter COPIES its text into the draft. Editing the draft afterwards changes
//     nothing stored, and the row that goes out points at no template at all rather than at
//     the one it began as (see `bulkEmailRows`). Email history still tells that send apart
//     from automated mail: it reads Hand-composed, derived from the key rather than from the
//     stored column, which `EmailLogSource` explains.
//   - Settings > Email Templates stays the one place a template is edited. Nothing here
//     writes, so there is no second write path to keep in step with `template-write.ts`.
//
// A stored row wins over the built-in default, and a stored row with an empty body does not,
// which is `resolveTemplate`'s rule reapplied rather than reinvented: the organizer sees the
// same body the trigger would have sent.
//
// Pure, and tested in tests/comms-bulk-starters.test.ts.

import { emailHtmlFromMarkdown } from '@/features/comms/markdown-email'
import { EDITABLE_TEMPLATES } from '@/features/comms/template-keys'
import type { EmailTemplate } from '@/types/domain'

export type BulkEmailStarter = {
  /** The `EmailTemplates.key`, used only to identify the pick in the composer. */
  readonly key: string
  readonly title: string
  readonly description: string
  readonly subject: string
  /** Already HTML, converted the same way the sender would have converted it. */
  readonly bodyHtml: string
  /** True when the organizer has saved their own version of this one. */
  readonly customized: boolean
}

/**
 * Every editable template, as something the composer can load into its draft.
 *
 * All of them, including the ones whose bodies name a submission. `accepted` carries
 * `{{submission.title}}`, which a roster send cannot supply, and hiding it would be the
 * wrong fix: an organizer who wants the acceptance wording as a starting point for a
 * different message is doing something reasonable, and `mergeFieldProblems` tells them
 * exactly which sentence to change before the send goes anywhere. A control that silently
 * omits half the list teaches nothing.
 */
export function bulkEmailStarters(stored: readonly EmailTemplate[]): readonly BulkEmailStarter[] {
  const byKey = new Map(stored.map((row) => [row.key, row]))

  return EDITABLE_TEMPLATES.map((meta) => {
    const row = byKey.get(meta.key)
    // The same `usable` test `resolveTemplate` applies: a blank body means "go back to the
    // built-in text", because Airtable's `+` makes blank rows and a half-written row is a
    // normal state of an authoring surface.
    const body = row?.bodyMarkdown.trim() === '' ? undefined : row?.bodyMarkdown
    const subject = row?.subject.trim() === '' ? undefined : row?.subject

    return {
      key: meta.key,
      title: meta.title,
      description: meta.description,
      subject: subject ?? meta.defaultSubject,
      bodyHtml: emailHtmlFromMarkdown(body ?? meta.defaultBody),
      customized: body !== undefined,
    }
  })
}
