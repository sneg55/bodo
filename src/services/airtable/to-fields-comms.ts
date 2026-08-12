// App input to an Airtable field set, for EmailTemplates.
//
// Inherits the rule to-fields.ts exists for: a link is an ARRAY even when it holds one id,
// `null` CLEARS a column, and an ABSENT key leaves the old value in place. Which of the
// last two applies is a decision per column, so each one below says which it made.
//
// The decision that matters here is that an EDIT always sends `subject` and `bodyMarkdown`,
// carrying `null` when the organizer emptied them. An omitted key would leave the previous
// body in place, and the previous body is the one that gets SENT: an organizer who cleared
// the editor to go back to the built-in default would keep mailing the text they had just
// deleted, with the panel showing an empty field. That is the one direction that cannot be
// undone from the UI, which is the same reasoning to-fields-resources.ts records for
// `embedHtml`.
//
// `bodyMarkdown` holds MARKDOWN, not HTML, and the column name is honest. The sender runs
// it through `@/features/comms/markdown-email` at resolve time. See that file for why the
// stored form is markdown while `Forms.confirmationEmailHtml` is HTML.

import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'

/** What the organizer authored, before it is a row. */
export type EmailTemplateEdit = {
  /** `accepted`, `rejected`, `reminder`, or `custom-*`. See @/features/comms/template-keys. */
  key: string
  subject: string
  bodyMarkdown: string
  attachIcs: boolean
}

export type EmailTemplateDraft = EmailTemplateEdit & { eventId: RecordId }

/**
 * A new EmailTemplates row.
 *
 * `compact`, so an empty subject or body is simply not sent: there is no previous value to
 * leave in place on a create, and writing `null` into a column that has never held a value
 * is noise. `attachIcs` is always sent, including `false`, because `compact` keeps a
 * boolean and a blank checkbox reads back as `false` anyway.
 */
export function emailTemplateFields(draft: EmailTemplateDraft): FieldSet {
  return compact({
    [COL.key]: draft.key,
    [COL.event]: link(draft.eventId),
    [COL.subject]: blankToUndefined(draft.subject),
    [COL.bodyMarkdown]: blankToUndefined(draft.bodyMarkdown),
    [COL.attachIcs]: draft.attachIcs,
  })
}

/**
 * An edit to an existing row.
 *
 * The event link is NOT sent, for the reason `resourceEditFields` gives: a template does
 * not change events, and re-sending the link on every save would make a mis-passed event id
 * a silent re-parenting rather than a failed write. The `key` is not sent either, because
 * the key is what the row was FOUND by: writing it back can only ever be a no-op, and
 * sending a different one would rename a template out from under the sender that reads it.
 */
export function emailTemplateEditFields(edit: Omit<EmailTemplateEdit, 'key'>): FieldSet {
  return {
    [COL.subject]: emptyToNull(edit.subject),
    [COL.bodyMarkdown]: emptyToNull(edit.bodyMarkdown),
    [COL.attachIcs]: edit.attachIcs,
  }
}

/** Dropped by `compact` on a create: there is nothing to clear. */
function blankToUndefined(value: string): string | undefined {
  return value.trim() === '' ? undefined : value
}

/** Cleared on an edit, so the trigger falls back to its built-in body. See the header. */
function emptyToNull(value: string): string | null {
  return value.trim() === '' ? null : value
}
