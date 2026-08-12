// Reading and writing the two admin email templates, with the authorization in front.
//
// Dependencies are arguments, in the same shape and for the same stated reason as
// `features/comms/drain.ts` and `features/jobs/reminders.ts`: the interesting property here
// is an ORDER (refuse before writing), and an implementation that reached for
// `requireEventRole` and the DAL itself could only be checked by driving a real session
// through a real base. `./template-actions.ts` is the one place that resolves these, and
// tests/comms-template-authorization.test.ts is what proves the order holds.
//
// Three rules, and the first is the security one:
//
//   1. `requireAdmin` runs FIRST, before the key is looked at and before anything is read.
//      A Server Action is reachable by POST with no layout ever rendering (BUILD_SPEC 4),
//      and a reviewer holds a role on the event but must not be able to rewrite the mail
//      every speaker receives. `roleSatisfies` ranks `reviewer` below `admin`, so the
//      requirement is `admin`.
//   2. The key comes from a closed list, never from the client. A typo'd key would be a
//      write nothing ever reads, and that failure is invisible: the save succeeds and the
//      mail keeps using the built-in body. The list is `EDITABLE_TEMPLATES`, which grew from
//      the two admin alerts to include the acceptance and decline emails when Settings >
//      Email Templates was built. Both surfaces post through this one guard, so a wider list
//      is a wider EDITOR and not a weaker check.
//   3. The event id scopes the write and is never a record id. `upsertEmailTemplate` finds
//      the row in the authorized event's own list or creates it there, so there is no path
//      by which a record id from another event could be edited.

import { AppError, ErrorIds } from '@/constants/errorIds'
import {
  ADMIN_TEMPLATES,
  type AdminTemplateMeta,
  editableTemplateFor,
  type TemplateKey,
} from '@/features/comms/template-keys'
import { fieldsUsedBy, mergeFields } from '@/features/comms/templates'
import type { EmailTemplateEdit } from '@/services/airtable/to-fields-comms'
import type { EmailTemplate, RecordId } from '@/types/domain'

/** Airtable long text holds far more, but a body this long is a paste accident. */
export const MAX_BODY_LENGTH = 20_000
/** A subject line longer than this is truncated by mail clients anyway. */
export const MAX_SUBJECT_LENGTH = 255

export type TemplateWriteDeps = {
  /** `requireEventRole(eventId, 'admin')`. Raises; it never returns a boolean. */
  requireAdmin: (eventId: RecordId) => Promise<void>
  listTemplates: (eventId: RecordId) => Promise<readonly EmailTemplate[]>
  save: (input: { eventId: RecordId; edit: EmailTemplateEdit }) => Promise<EmailTemplate>
}

/** One panel row as the client edits it: what is stored, plus what the default would be. */
export type AdminTemplateValue = {
  key: TemplateKey
  title: string
  description: string
  /** Empty means "no row stored", which is what makes the built-in body send. */
  subject: string
  bodyMarkdown: string
  /** Shown so an organizer can see what they are overriding, and restore it. */
  defaultSubject: string
  defaultBody: string
  /** True when a row with a body exists, i.e. when this template is what gets sent. */
  customized: boolean
}

/**
 * Both rows for the panel, authorized.
 *
 * The READ is authorized too, not only the write. An event's email bodies are event data:
 * they name recipients' expectations, and on a shared base the templates of an event you
 * hold no role on are none of your business.
 */
export async function loadAdminTemplates(
  deps: TemplateWriteDeps,
  eventId: RecordId,
  /**
   * Which templates to return. Defaults to the builder's two admin alerts, so the panel on
   * step 7 is unchanged; Settings > Email Templates passes `EDITABLE_TEMPLATES` and gets the
   * speaker emails as well. A list rather than a flag, because the closed list a caller may
   * ask for and the closed list a write is checked against are the same kind of thing.
   */
  metas: readonly AdminTemplateMeta[] = ADMIN_TEMPLATES,
): Promise<readonly AdminTemplateValue[]> {
  await deps.requireAdmin(eventId)
  const stored = await deps.listTemplates(eventId)

  return metas.map((meta) => {
    const row = stored.find((candidate) => candidate.key === meta.key)
    return valueOf(meta, row)
  })
}

export type SaveAdminTemplateInput = {
  eventId: RecordId
  /** Checked against the closed list. An unknown key is refused, not created. */
  key: string
  subject: string
  bodyMarkdown: string
}

/**
 * Save one row, or say why not.
 *
 * Returns the value the panel should now show, read back off the written record rather than
 * echoed from the input, so a column Airtable rejected does not leave the UI claiming a
 * body that was never stored.
 */
export async function saveAdminTemplate(
  deps: TemplateWriteDeps,
  input: SaveAdminTemplateInput,
): Promise<AdminTemplateValue> {
  // Rule 1. Before the key check, before the read, before the write.
  await deps.requireAdmin(input.eventId)

  const meta = editableTemplateFor(input.key)
  if (meta === undefined) {
    throw new AppError(ErrorIds.MAIL_TEMPLATE_MISSING, 'that is not an editable template', {
      key: input.key,
      eventId: input.eventId,
    })
  }

  assertLength('body', input.bodyMarkdown, MAX_BODY_LENGTH)
  assertLength('subject', input.subject, MAX_SUBJECT_LENGTH)
  assertMergeFields(input.subject, input.bodyMarkdown)

  const saved = await deps.save({
    eventId: input.eventId,
    edit: {
      key: meta.key,
      subject: input.subject.trim(),
      bodyMarkdown: input.bodyMarkdown,
      // Never set from this panel. A row asking for a calendar invite whose submission has
      // no scheduled time is a permanent MAIL_ICS_INVALID (invite-attachment.ts), and
      // `resolveTemplate` ignores the stored flag for exactly that reason.
      attachIcs: false,
    },
  })

  return valueOf(meta, saved)
}

function valueOf(meta: AdminTemplateMeta, row: EmailTemplate | undefined): AdminTemplateValue {
  return {
    key: meta.key,
    title: meta.title,
    description: meta.description,
    subject: row?.subject ?? '',
    bodyMarkdown: row?.bodyMarkdown ?? '',
    defaultSubject: meta.defaultSubject,
    defaultBody: meta.defaultBody,
    // The same test `resolveTemplate` applies: a row whose body is blank does not send.
    customized: (row?.bodyMarkdown ?? '').trim() !== '',
  }
}

function assertLength(what: string, value: string, max: number): void {
  if (value.length <= max) return
  throw new AppError(
    ErrorIds.SUB_VALIDATION_FAIL,
    `the ${what} is ${String(value.length)} characters, and the limit is ${String(max)}`,
    { what, length: value.length, max },
  )
}

/**
 * Every merge field the two strings name has to be one the send-time context can supply.
 *
 * Checked HERE, at save time, and this is the reason `mergeFields` is a flat map rather than
 * a walk over a nested object: `renderTemplate` raises on an unknown field, and the drain
 * treats that as permanent, so without this check a typo in a merge field is a template that
 * saves cleanly and then fails on every recipient with nothing on screen to explain it.
 *
 * The allowed set is DERIVED from `mergeFields` with every optional value populated, not
 * listed again. A second list would drift the day a field is added, and the drift would show
 * up as the builder refusing a merge field that works.
 */
function assertMergeFields(subject: string, bodyMarkdown: string): void {
  const allowed = new Set(
    mergeFields({
      speaker: { firstName: 'a', lastName: 'a', email: 'a', company: 'a' },
      event: { name: 'a', slug: 'a', startsAt: 'a', location: 'a' },
      submission: { code: 'a', title: 'a', startsAt: 'a', room: 'a' },
      task: { title: 'a', dueAt: 'a' },
      portalUrl: 'a',
      magicLink: 'a',
    }).keys(),
  )

  const unknown = [...fieldsUsedBy(subject), ...fieldsUsedBy(bodyMarkdown)].filter(
    (field) => !allowed.has(field),
  )
  if (unknown.length === 0) return

  throw new AppError(
    ErrorIds.MAIL_MERGE_FIELD_UNKNOWN,
    `these merge fields do not exist: ${[...new Set(unknown)].join(', ')}`,
    { unknown },
  )
}
