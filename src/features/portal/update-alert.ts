// The `submission.admin_update` trigger: what an organizer is told when a speaker edits
// something they have already submitted.
//
// BUILD_SPEC 5.3's table gives this row as "Submission edited by the speaker after submit,
// to `Forms.adminAlertOnUpdate` recipients, gated by the recipient list being non-empty".
// Like every other trigger it ENQUEUES and returns: nothing here sends, and nothing here
// imports the provider (see the header of @/features/submissions/decision-outbox).
//
// The row building itself now lives in `@/features/comms/admin-alert`, shared with the
// `submission.admin_new` alert. This file is the portal's entry point into it and keeps its
// own name, because `save-body.ts` is the one caller and "the alert a portal edit owes" is
// the concept that belongs here.
//
// Why it moved: the two alerts agreed on everything that is easy to get wrong (per-recipient
// keys, case-insensitive dedupe, the fallbacks that stop a blank speaker name from raising
// after the save has already landed) and differed only in the key and the recipient column.
// They now also share the stored-template lookup, which is the point: the body comes from the
// organizer's `EmailTemplates[key=custom-admin-update]` row when there is one, and from the
// built-in markdown default when there is not, with `templateSource` recording which.

import { adminAlertRows } from '@/features/comms/admin-alert'
import type { OutboxDraft } from '@/features/comms/triggers'
import type { EmailTemplate, RecordId } from '@/types/domain'

export type UpdateAlertInput = {
  readonly eventId: RecordId
  readonly eventName: string
  readonly eventSlug: string
  readonly submissionId: RecordId
  readonly submissionTitle: string
  readonly submissionCode: string
  /** `Forms.adminAlertOnUpdate`. Empty means this trigger is switched off for the form. */
  readonly recipients: readonly string[]
  /** The speaker who saved the edit, named in the body so the organizer knows who. */
  readonly editor: { readonly name: string; readonly email: string }
  /** The instant the edit was saved. In the key, so a later edit is a new message. */
  readonly updatedAt: string
  /**
   * Where the organizer should land. The merge context 5.3 fixes has one link slot and
   * calls it `portalUrl`; for an admin alert the useful destination is the submission in
   * the admin app, so that is what goes in it.
   */
  readonly linkUrl: string
  /**
   * The event's `EmailTemplates[key=custom-admin-update]` row, when it has one. Optional so
   * a caller that cannot read it (or an event that has none) still sends the built-in body
   * rather than nothing: an alert an organizer never receives is worse than a generic one.
   */
  readonly template?: EmailTemplate
}

export function adminUpdateOutboxRows(input: UpdateAlertInput): readonly OutboxDraft[] {
  return adminAlertRows({
    kind: 'update',
    eventId: input.eventId,
    eventName: input.eventName,
    eventSlug: input.eventSlug,
    submissionId: input.submissionId,
    submissionTitle: input.submissionTitle,
    submissionCode: input.submissionCode,
    recipients: input.recipients,
    actor: input.editor,
    at: input.updatedAt,
    linkUrl: input.linkUrl,
    template: input.template,
  })
}
