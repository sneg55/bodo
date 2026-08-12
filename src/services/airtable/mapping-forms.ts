// Every HTML column is sanitized HERE, at the read boundary, which is the only place that both
// covers a value typed straight into Airtable and keeps the sanitizer off the client.
//
// It started at the render sinks, and that was wrong twice over even though it did stop the XSS.
// `OrganizerHtml` is reached from the public wizard's CLIENT components, so putting the call there
// shipped sanitize-html and its postcss dependency into the browser bundle on a project judged on
// speed, and it left the RAW markup in the RSC flight payload for anyone to read. Measured on the
// deployed Worker, not inferred: the hostile value was gone from the rendered DOM and present,
// escaped, in the payload, and the sanitizer appeared in three client chunks.
//
// Sanitizing on the way out of the DAL means no consumer can forget, the browser never receives
// the unsafe string, and the builder's editor loads the normalised value it will store anyway.
// Form records to the `Form` type in src/types/forms.ts.
//
// A form is mostly JSON blobs, so it is where a bad write shows up worst: a form
// whose `fieldsJson` does not parse renders as a wizard with no questions, and a
// speaker cannot tell that from a form that is genuinely empty. Every blob is
// therefore validated, and a failure throws with the record id rather than
// falling back to an empty array.
//
// The one deliberate exception is `rolesJson`, which falls back to
// DEFAULT_PARTICIPANT_ROLES when the column is blank. A form created before the
// roles panel existed has no blob, and the default (one required speaker, up to
// four optional co-speakers) is the one that lets a solo speaker submit. See the
// note on DEFAULT_PARTICIPANT_ROLES for why that default is load-bearing.

import { DEFAULT_PARTICIPANT_ROLES, FORM_ENTITY_KINDS, TASK_ENTITY_TYPES } from '@/constants/status'
import {
  type AirtableRecord,
  checkbox,
  choiceOr,
  emailList,
  jsonBlob,
  optionalChoice,
  optionalNumber,
  optionalText,
  requiredLink,
  text,
  view,
} from '@/services/airtable/records'
import {
  crossFieldLimitsSchema,
  formFieldsSchema,
  participantRolesSchema,
  routingSchema,
} from '@/services/airtable/schemas'
import { COL, TABLES } from '@/services/airtable/tables'
import type { Form } from '@/types/forms'
import { safeStoredHtml } from '@/utils/safe-html'

const EMPTY_ROUTING = { rules: [], defaultTrackId: undefined }

export function mapForm(record: AirtableRecord): Form {
  const source = view(TABLES.forms, record)
  const roles = jsonBlob(source, COL.rolesJson, participantRolesSchema, [])

  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    name: text(source, COL.name),
    // Required, and not defaulted: the public CFP URL is keyed on this, so a form
    // without one is unreachable and the admin needs to be told, not routed to a
    // form that answers to every publicId at once.
    publicId: text(source, COL.publicId),
    kind: choiceOr(source, COL.kind, ['cfp', 'task'] as const, 'cfp'),
    // Section 5.1b: this decides whether the content goes through review at all,
    // so `abstracts` (the reviewed path) is the safe default for a blank column.
    entityKind: choiceOr(source, COL.entityKind, FORM_ENTITY_KINDS, 'abstracts'),
    // Optional rather than defaulted, because a CFP form has none and inventing
    // `contact` for one would make it look like a portal form addressed to people.
    entityType: optionalChoice(source, COL.entityType, TASK_ENTITY_TYPES),
    participantsEnabled: checkbox(source, COL.participantsEnabled),
    status: choiceOr(source, COL.status, ['draft', 'published'] as const, 'draft'),
    // Participant-facing copy. All eight are optional and none is defaulted: a form
    // created before these columns existed has every one of them blank, and the public
    // wizard falls back per field rather than rendering an empty heading.
    externalTitle: optionalText(source, COL.externalTitle),
    welcomeHeading: optionalText(source, COL.welcomeHeading),
    welcomeHtml: safeStoredHtml(optionalText(source, COL.welcomeHtml)),
    abstractSectionTitle: optionalText(source, COL.abstractSectionTitle),
    abstractHeading: optionalText(source, COL.abstractHeading),
    abstractSectionHtml: safeStoredHtml(optionalText(source, COL.abstractSectionHtml)),
    participantSectionTitle: optionalText(source, COL.participantSectionTitle),
    participantHeading: optionalText(source, COL.participantHeading),
    participantSectionHtml: safeStoredHtml(optionalText(source, COL.participantSectionHtml)),
    successHtml: safeStoredHtml(optionalText(source, COL.successHtml)),
    fields: jsonBlob(source, COL.fieldsJson, formFieldsSchema, []),
    participantFields: jsonBlob(source, COL.participantFieldsJson, formFieldsSchema, []),
    routing: jsonBlob(source, COL.routingJson, routingSchema, EMPTY_ROUTING),
    roles: roles.length > 0 ? roles : DEFAULT_PARTICIPANT_ROLES,
    crossFieldLimits: jsonBlob(source, COL.crossFieldLimitsJson, crossFieldLimitsSchema, []),
    closeDate: optionalText(source, COL.closeDate),
    submissionLimit: optionalNumber(source, COL.submissionLimit),
    allowMultipleDrafts: checkbox(source, COL.allowMultipleDrafts),
    autoRedirectToPortal: checkbox(source, COL.autoRedirectToPortal),
    confirmationEmailEnabled: checkbox(source, COL.confirmationEmailEnabled),
    confirmationEmailHtml: safeStoredHtml(optionalText(source, COL.confirmationEmailHtml)),
    adminAlertOnNew: emailList(source, COL.adminAlertOnNew),
    adminAlertOnUpdate: emailList(source, COL.adminAlertOnUpdate),
  }
}
