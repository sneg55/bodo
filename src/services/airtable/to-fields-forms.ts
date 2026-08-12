// A form definition to an Airtable field set. The write direction of mapping-forms.ts.
//
// Split from to-fields.ts for the line limit, and it keeps that file's rules, which are
// the whole reason this direction has its own module: a link goes out as an ARRAY of
// record ids, clearing a date needs `null` rather than `''`, and omitting a key leaves
// the old value in place. The last one is the trap here. `compact` drops `undefined`, so
// an organizer who deletes the welcome message would leave the previous text published
// unless absence is turned into an explicit empty value on the way out.
//
// The JSON blobs are stringified here and nowhere else. They are validated on the way
// back in by the Zod schemas in schemas.ts, which is where the `registryKey` note lives:
// that key is the only thing that routes an answer into a typed column, so this writes
// the field objects as they were built and derives nothing.

import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import type { Form, FormContent } from '@/types/forms'

/**
 * A long text column an organizer can empty. `''` clears it, where `undefined` would
 * silently leave the old body in place.
 */
function clearableText(value: string | undefined): string {
  return value ?? ''
}

/** A date or number column an organizer can empty. Airtable needs `null`, not `''`. */
function clearableValue<T>(value: T | undefined): T | null {
  return value ?? null
}

/** An email list column. `emailList` reads it back as a comma separated string. */
function emailField(emails: readonly string[]): string {
  return emails.join(', ')
}

/** Everything that belongs to the form's content, which is what the builder edits. */
export function formContentFields(write: FormContent): FieldSet {
  return compact({
    [COL.name]: write.name,
    [COL.entityKind]: write.entityKind,
    // Portal forms only, and `compact` therefore leaves a CFP form's blank column alone
    // rather than writing a value into a select that has never held one.
    [COL.entityType]: write.entityType,
    [COL.participantsEnabled]: write.participantsEnabled,
    // Participant-facing copy, every one of it clearable: an organizer who deletes a
    // section heading means the public page should stop showing it, and `compact` would
    // otherwise leave the old text published.
    [COL.externalTitle]: clearableText(write.externalTitle),
    [COL.welcomeHeading]: clearableText(write.welcomeHeading),
    [COL.welcomeHtml]: clearableText(write.welcomeHtml),
    [COL.abstractSectionTitle]: clearableText(write.abstractSectionTitle),
    [COL.abstractHeading]: clearableText(write.abstractHeading),
    [COL.abstractSectionHtml]: clearableText(write.abstractSectionHtml),
    [COL.participantSectionTitle]: clearableText(write.participantSectionTitle),
    [COL.participantHeading]: clearableText(write.participantHeading),
    [COL.participantSectionHtml]: clearableText(write.participantSectionHtml),
    [COL.successHtml]: clearableText(write.successHtml),
    [COL.fieldsJson]: JSON.stringify(write.fields),
    [COL.participantFieldsJson]: JSON.stringify(write.participantFields),
    [COL.routingJson]: JSON.stringify(write.routing),
    [COL.rolesJson]: JSON.stringify(write.roles),
    [COL.crossFieldLimitsJson]: JSON.stringify(write.crossFieldLimits),
    [COL.closeDate]: clearableValue(write.closeDate),
    [COL.submissionLimit]: clearableValue(write.submissionLimit),
    [COL.allowMultipleDrafts]: write.allowMultipleDrafts,
    [COL.autoRedirectToPortal]: write.autoRedirectToPortal,
    [COL.confirmationEmailEnabled]: write.confirmationEmailEnabled,
    [COL.confirmationEmailHtml]: clearableText(write.confirmationEmailHtml),
    [COL.adminAlertOnNew]: emailField(write.adminAlertOnNew),
    [COL.adminAlertOnUpdate]: emailField(write.adminAlertOnUpdate),
  })
}

export type NewFormRecord = {
  eventId: RecordId
  /** Opaque and immutable once created: it is what the public CFP URL carries. */
  publicId: string
  /**
   * `cfp` for a call for papers, `task` for a portal form (BUILD_SPEC 5.6). Explicit and
   * with no default, because it is assigned once and never edited: it decides which of the
   * two admin lists the record appears in and which editor can open it, so a caller that
   * forgot it would file the form under the wrong surface permanently.
   */
  kind: Form['kind']
  status: 'draft' | 'published'
  write: FormContent
}

/** A new form record. */
export function newFormFields(input: NewFormRecord): FieldSet {
  return {
    ...formContentFields(input.write),
    [COL.event]: link(input.eventId),
    [COL.publicId]: input.publicId,
    [COL.kind]: input.kind,
    [COL.status]: input.status,
  }
}

/** Publish and unpublish, which is a one-column write and deliberately not a content one. */
export function formStatusFields(status: 'draft' | 'published'): FieldSet {
  return { [COL.status]: status }
}
