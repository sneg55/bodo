// Lifting each session's abstract out of `answersJson`, for the public surfaces.
//
// The abstract is not a column. The field registry marks `description` as `column: false`
// (src/constants/fields.ts), so it lives in `answersJson` keyed by the FORM FIELD's id,
// and a submission cannot be read for it without also reading the form it came through.
// That is the whole reason this is a separate step rather than another property on the
// row: the schedule reader had no need of forms until a public card had to show a
// description, and every caller now pays exactly one extra cached list read.
//
// It resolves the field BY REGISTRY KEY, reusing `abstractField` and `storedAbstract`
// from the organizer's editor rather than repeating the lookup. That matters more than it
// looks: those two are what the organizer's edit writes THROUGH, so the text a visitor
// reads and the text an organizer edits are guaranteed to be the same answer. A second
// implementation here that matched on label would eventually show one and edit the other.

import { abstractField, storedAbstract } from '@/features/review/content-edit'
import type { SubmissionWithParticipants } from '@/types/domain'
import type { Form } from '@/types/forms'
import { safeRichHtml } from '@/utils/safe-html'

/** What this needs off a row, so a caller can pass anything submission-shaped. */
type DescribableRow = Pick<SubmissionWithParticipants, 'formId' | 'answers'>

/**
 * `row -> abstract`, or `undefined` where there is none.
 *
 * The value is HTML, and it is SANITIZED here. The abstract is a `wysiwyg` answer, so what
 * is stored is markup, and every public surface printed it as text: an embed card read
 * `<P>NINETY MINUTES, BRING A LAPTOP.</P>`, tags and all. Escaping was never the right
 * answer for a field the speaker wrote in a rich text editor; refusing to render it as
 * HTML was, only while this codebase had no sanitizer. It has one now (`safeRichHtml`),
 * and the rule that comes with it is that sanitizing happens on the way OUT OF THE READ
 * and never at a sink: these two callers are server-side reads, so a client embed renders
 * a string that is already safe and no sanitizer is shipped to the browser.
 *
 * This is the boundary for the PUBLIC description specifically. The organizer and reviewer
 * surfaces read the same answer through `submittedAnswers`, which still flattens it with
 * `htmlToText`, and they are left alone: an organizer comparing two versions wants the
 * text, not a rendered diff.
 *
 * Built once per read rather than per row: resolving the form and its abstract field for
 * every session in a 200-session agenda would be 200 array scans of the same two lists,
 * and it now also means the sanitizer is constructed once per read rather than per session.
 */
export function describeSessions(
  forms: readonly Form[],
): (row: DescribableRow) => string | undefined {
  // Keyed by form id, and the VALUE is the field, so a form with no abstract question
  // resolves once to `undefined` instead of being looked up again per session.
  const fieldByForm = new Map(forms.map((form) => [form.id, abstractField(form)]))

  return (row) => {
    if (row.formId === undefined) return undefined
    const field = fieldByForm.get(row.formId)
    if (field === undefined) return undefined
    // `storedAbstract` wants a full submission but reads only `answers`, so the cast is
    // the narrow row standing in for it rather than a widening of what is trusted.
    const text = storedAbstract({ answers: row.answers } as SubmissionWithParticipants, field)
    if (text === '') return undefined

    const html = safeRichHtml(text)
    // A body that was nothing but disallowed markup sanitizes to an empty string, and an
    // empty description has to read as absent rather than as an empty rendered block.
    return html.trim() === '' ? undefined : html
  }
}
