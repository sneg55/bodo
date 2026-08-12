// The editor's state, and the one function that turns it into what gets stored.
//
// Two shapes, deliberately not one. `FormDraft` is what the controls bind to, so every
// value a control owns is a string or a boolean: an empty close date is `''` because a
// date input has no concept of "absent", and a submission limit is the text the
// organizer typed. `FormWrite` is the stored shape, where absent means absent.
//
// The participant-facing copy (external title, page headings, section titles and the two
// description bodies) is the same idea and lives in `headings.ts`, intersected into
// `FormDraft` and spread into the write. Eight more keys with two shared caps and one
// mapping rule read better as their own module than as eight more lines here.
//
// Everything that crosses between them is here rather than in a component, because a
// component cannot be unit tested cheaply and this is where the CFP path breaks. The
// property that matters most is `registryKey`: it is the only thing that routes an answer
// into a typed Airtable column (see the note on it in `@/services/airtable/schemas`), so
// `normalizeField` copies it through untouched and never derives it from anything.

import type { FormEntityKind, TaskEntityType } from '@/constants/status'
import { DEFAULT_PARTICIPANT_ROLES } from '@/constants/status'
import { dateKeyAt, minutesAt, zonedDateTimeToIso } from '@/features/agenda/time'
import {
  type FormHeadings,
  headingsFromForm,
  headingsToWrite,
} from '@/features/forms/builder/headings'
import { blankToUndefined } from '@/features/forms/builder/text'
import { isEmailLike, normalizeEmail } from '@/features/team/members'
import type {
  CrossFieldLimit,
  FieldCondition,
  FieldOption,
  FieldType,
  Form,
  FormContent,
  FormField,
  ParticipantRoleRule,
  RoutingConfig,
} from '@/types/forms'

/** Field types that carry an option list. Anything else drops one it was given. */
export const OPTION_TYPES: readonly FieldType[] = ['select', 'multiselect', 'radio']

export type FormDraft = FormHeadings & {
  /** The INTERNAL form name, which the organizer searches the list by. */
  name: string
  entityKind: FormEntityKind
  /**
   * Portal forms only: the `Type` cards on step 1 of the 3-step wizard (parity ref 27).
   * Absent for a CFP form, whose own step 1 asks `entityKind` instead.
   */
  entityType?: TaskEntityType
  participantsEnabled: boolean
  /** The "Show message" toggle on step 2, which is not the same as an empty body. */
  welcomeEnabled: boolean
  welcomeHtml: string
  successHtml: string
  fields: readonly FormField[]
  participantFields: readonly FormField[]
  routing: RoutingConfig
  roles: readonly ParticipantRoleRule[]
  crossFieldLimits: readonly CrossFieldLimit[]
  /** `datetime-local` text, or `''` for no deadline. */
  closeDate: string
  submissionLimitEnabled: boolean
  submissionLimit: string
  allowMultipleDrafts: boolean
  autoRedirectToPortal: boolean
  confirmationEmailEnabled: boolean
  confirmationEmailHtml: string
  adminAlertOnNew: readonly string[]
  adminAlertOnUpdate: readonly string[]
}

/**
 * The stored half of a form. Declared in types/forms.ts as `FormContent`, and aliased
 * here rather than redeclared so the DAL can take it without importing a feature module.
 */
export type FormWrite = FormContent

export function draftFromForm(form: Form, timeZone: string): FormDraft {
  return {
    ...headingsFromForm(form),
    name: form.name,
    entityKind: form.entityKind,
    entityType: form.entityType,
    participantsEnabled: form.participantsEnabled,
    // A stored body is a body the organizer wanted shown. There is no separate
    // column for the toggle, so it is derived, and derived this way round because
    // the alternative hides text that is already published.
    welcomeEnabled: (form.welcomeHtml ?? '').trim().length > 0,
    welcomeHtml: form.welcomeHtml ?? '',
    successHtml: form.successHtml ?? '',
    fields: form.fields,
    participantFields: form.participantFields,
    routing: form.routing,
    roles: form.roles.length > 0 ? form.roles : DEFAULT_PARTICIPANT_ROLES,
    crossFieldLimits: form.crossFieldLimits,
    closeDate: toLocalInput(form.closeDate, timeZone),
    submissionLimitEnabled: form.submissionLimit !== undefined,
    submissionLimit: form.submissionLimit === undefined ? '' : String(form.submissionLimit),
    allowMultipleDrafts: form.allowMultipleDrafts,
    autoRedirectToPortal: form.autoRedirectToPortal,
    confirmationEmailEnabled: form.confirmationEmailEnabled,
    confirmationEmailHtml: form.confirmationEmailHtml ?? '',
    adminAlertOnNew: form.adminAlertOnNew,
    adminAlertOnUpdate: form.adminAlertOnUpdate,
  }
}

export function toFormWrite(draft: FormDraft, timeZone: string): FormWrite {
  const fields = normalizeFields(draft.fields)
  return {
    ...headingsToWrite(draft),
    name: draft.name.trim(),
    entityKind: draft.entityKind,
    entityType: draft.entityType,
    participantsEnabled: draft.participantsEnabled,
    welcomeHtml: draft.welcomeEnabled ? blankToUndefined(draft.welcomeHtml) : undefined,
    successHtml: blankToUndefined(draft.successHtml),
    fields,
    // Participant questions are dropped entirely when the step is off, so a form that
    // does not collect participants cannot fail a required participant question that
    // nobody is shown.
    participantFields: draft.participantsEnabled
      ? normalizeFields(draft.participantFields)
      : draft.participantFields,
    routing: normalizeRouting(draft.routing, fields),
    roles: draft.roles.map(normalizeRole),
    crossFieldLimits: draft.crossFieldLimits,
    closeDate: toIsoOrUndefined(draft.closeDate, timeZone),
    submissionLimit: draft.submissionLimitEnabled ? toLimit(draft.submissionLimit) : undefined,
    allowMultipleDrafts: draft.allowMultipleDrafts,
    autoRedirectToPortal: draft.autoRedirectToPortal,
    confirmationEmailEnabled: draft.confirmationEmailEnabled,
    confirmationEmailHtml: blankToUndefined(draft.confirmationEmailHtml),
    adminAlertOnNew: cleanEmails(draft.adminAlertOnNew),
    adminAlertOnUpdate: cleanEmails(draft.adminAlertOnUpdate),
  }
}

/**
 * Field definitions as they are stored: in editor order, with the editor's empty
 * strings turned back into absence and a `showIf` that no longer points anywhere
 * dropped.
 *
 * The dangling-reference case is the one worth naming. `visibleFields` shows a field
 * whose controller was deleted, on purpose, so the answer is never silently stripped.
 * That is the right behaviour at render time and the wrong thing to persist: the
 * condition is dead, and leaving it in the blob means the next organizer to open the
 * editor sees a rule pointing at a question that is not there.
 */
export function normalizeFields(fields: readonly FormField[]): readonly FormField[] {
  const ids = new Set(fields.map((field) => field.id))
  return fields.map((field) => normalizeField(field, ids))
}

function normalizeField(field: FormField, ids: ReadonlySet<string>): FormField {
  const live =
    field.showIf !== undefined && field.showIf.fieldId !== field.id && ids.has(field.showIf.fieldId)
      ? field.showIf
      : undefined
  // Condition values are trimmed with the SAME rule as option values, so a rule written
  // against " yes " still matches the option it was written against once that option
  // becomes "yes". Without this, normalization silently broke the rule: the value no longer
  // matched anything and the field was simply never shown. Found by Codex review.
  const showIf = live === undefined ? undefined : trimConditionValues(live)
  const options = OPTION_TYPES.includes(field.type) ? cleanOptions(field.options) : undefined

  return {
    id: field.id,
    type: field.type,
    label: field.label.trim(),
    help: blankToUndefined(field.help ?? ''),
    // A locked field's Required toggle is rendered on and disabled, so the stored
    // value has to agree with it rather than with whatever the blob last held.
    required: field.locked === true ? true : field.required,
    options,
    showIf,
    maxLen: field.maxLen !== undefined && field.maxLen > 0 ? Math.floor(field.maxLen) : undefined,
    // Copied through, never derived. See the header note.
    registryKey: field.registryKey,
    locked: field.locked,
    mapsToSpeakerField: field.mapsToSpeakerField,
  }
}

/** A condition's values, trimmed exactly as `cleanOptions` trims the values they match. */
function trimConditionValues(condition: FieldCondition): FieldCondition {
  const value = condition.value
  if (value === undefined) return condition
  // `Array.isArray` does not narrow a `readonly string[]` out of the union, so the string
  // case is tested directly.
  const trimmed = typeof value === 'string' ? value.trim() : value.map((entry) => entry.trim())
  return { ...condition, value: trimmed }
}

function cleanOptions(options: readonly FieldOption[] | undefined): readonly FieldOption[] {
  return (options ?? [])
    .map((option) => ({ value: option.value.trim(), label: option.label.trim() }))
    .filter((option) => option.value.length > 0)
    .map((option) => ({ value: option.value, label: option.label || option.value }))
}

/**
 * Routing rules that can still fire. A rule whose controlling question was deleted
 * matches nothing, and a rule with no track routes to nothing, so both are dropped
 * rather than stored as a mapping the organizer believes is live.
 */
function normalizeRouting(routing: RoutingConfig, fields: readonly FormField[]): RoutingConfig {
  const ids = new Set(fields.map((field) => field.id))
  return {
    rules: routing.rules.filter(
      (rule) => ids.has(rule.when.fieldId) && rule.trackId.trim().length > 0,
    ),
    defaultTrackId: blankToUndefined(routing.defaultTrackId ?? ''),
  }
}

function normalizeRole(rule: ParticipantRoleRule): ParticipantRoleRule {
  const min = clamp(rule.min)
  return { role: rule.role, enabled: rule.enabled, min, max: Math.max(min, clamp(rule.max)) }
}

function clamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(99, Math.floor(value))
}

function toLimit(text: string): number | undefined {
  const parsed = Number(text.trim())
  if (!Number.isFinite(parsed) || parsed < 1) return undefined
  return Math.floor(parsed)
}

/**
 * The alert recipients as they are stored: normalized addresses, de-duplicated, and only the
 * ones that are addresses at all.
 *
 * Trimming was not enough. This runs on the SERVER save path, and the column it writes feeds
 * `adminAlertRows`, so whatever survives here is handed to the email provider later. The
 * `MemberPicker` refuses a malformed address in the browser, but a Server Action takes its
 * whole draft from the caller, so client validation is not a check on a POST. Normalizing also
 * collapses `Sam@Example.com` and `sam@example.com`, which are one mailbox and were two rows in
 * the outbox. Found by Codex review.
 *
 * A non-address is dropped rather than refused, unlike a deleted locked field: the value can
 * only come from a payload the picker did not build or from a column somebody filled in
 * Airtable, both of which are already unsendable, and refusing would make a form carrying one
 * unsaveable for every unrelated edit.
 */
function cleanEmails(emails: readonly string[]): readonly string[] {
  const kept = new Set<string>()
  for (const raw of emails) {
    const email = normalizeEmail(raw)
    if (email !== '' && isEmailLike(email)) kept.add(email)
  }
  return [...kept]
}

/**
 * `datetime-local` gives no zone, so the text is stamped with the browser's own
 * offset by `new Date(...)`. That is the reading the organizer meant: they typed a
 * wall-clock time in front of a calendar, not a UTC instant.
 */
/**
 * A `datetime-local` value read as a wall-clock time in the EVENT's zone.
 *
 * `new Date('2026-09-15T23:59')` is interpreted in the runtime's own zone, and both this and
 * its inverse run server side, where on Workers that zone is UTC. So a deadline of 23:59 for
 * a California event was stored as 23:59Z, which is 16:59 there: the form closed seven hours
 * early. `zonedDateTimeToIso` is the same helper the agenda uses to place a dropped session,
 * and it already handles the DST edges.
 */
function toIsoOrUndefined(local: string, timeZone: string): string | undefined {
  const trimmed = local.trim()
  if (trimmed.length === 0) return undefined
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/u.exec(trimmed)
  if (match === null) return undefined
  const [, dateKey = '', hour = '0', minute = '0'] = match
  return zonedDateTimeToIso(dateKey, Number(hour) * 60 + Number(minute), timeZone)
}

/**
 * The inverse, to the minute, which is the precision the control offers.
 *
 * Also in the EVENT's zone, and it has to be the same zone `toIsoOrUndefined` writes in, or
 * opening the editor and pressing Save without touching anything would shift the deadline.
 * `getFullYear`/`getHours` read the RUNTIME's zone, which is UTC on Workers.
 */
function toLocalInput(iso: string | undefined, timeZone: string): string {
  if (iso === undefined) return ''
  const dateKey = dateKeyAt(iso, timeZone)
  const minutes = minutesAt(iso, timeZone)
  if (dateKey === undefined || minutes === undefined) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${dateKey}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}
