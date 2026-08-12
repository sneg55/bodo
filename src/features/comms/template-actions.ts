'use server'

// The two Server Actions behind the builder's "Admin notifications" panel.
//
// Thin on purpose. Everything that can be got wrong lives in ./template-write.ts, which
// takes the guard and the DAL as arguments so the refuse-before-writing order is testable
// (tests/comms-template-authorization.test.ts); ./template-deps.ts resolves those arguments,
// in the same shape as `features/jobs/reminders-wiring.ts`, and is a separate module because
// every export of a `'use server'` file is a POST endpoint.
//
// The save is shared with Settings > Email Templates, which edits the same rows through the
// same guard. That page reads on the server, so it calls the write layer directly rather
// than through the load action here.
//
// `requireEventRole(eventId, 'admin')` is wired in here rather than relied on from
// `(admin)/admin/[eventId]/layout.tsx`, and BUILD_SPEC 4 is why: a Server Action is
// reachable by POST with no layout ever rendering, and a reviewer holds a role on the event.
// Rewriting the mail every speaker receives is not a review capability.
//
// Failures come back as values rather than thrown, matching the rest of the builder's
// actions: a thrown AppError crossing the action boundary reaches the browser as a redacted
// digest, and "that merge field does not exist" is something the organizer can act on.

import { templateDeps as deps, templatePreviewDeps } from '@/features/comms/template-deps'
import type { TemplatePreview } from '@/features/comms/template-preview'
import { previewAdminTemplate } from '@/features/comms/template-preview-load'
import {
  type AdminTemplateValue,
  loadAdminTemplates,
  saveAdminTemplate,
} from '@/features/comms/template-write'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import type { RecordId } from '@/types/domain'

/** Both panel rows, with what is stored and what the built-in default would be. */
export async function loadAdminTemplatesAction(input: {
  eventId: RecordId
}): Promise<ActionResult<{ templates: readonly AdminTemplateValue[] }>> {
  try {
    return actionOk({ templates: await loadAdminTemplates(deps(), input.eventId) })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Render one template with its merge fields filled in, without saving it. SPK-14.
 *
 * It takes the subject and body from the EDITOR rather than reading the stored row, so what
 * is previewed is what is on screen: an organizer checks their wording before committing it,
 * which is the only order in which a preview is worth having. Nothing is written.
 *
 * A refusal comes back as a value like every other action here, and it is the useful half:
 * `renderTemplate` throws `MAIL_MERGE_FIELD_UNKNOWN` naming the field, so a typo'd merge
 * field is a message the organizer can act on rather than a send that fails per recipient.
 */
export async function previewAdminTemplateAction(input: {
  eventId: RecordId
  key: string
  subject: string
  bodyMarkdown: string
}): Promise<ActionResult<{ preview: TemplatePreview }>> {
  try {
    return actionOk({ preview: await previewAdminTemplate(templatePreviewDeps(), input) })
  } catch (error) {
    return actionFailure(error)
  }
}

/** Save one template. The key is checked against the closed list inside the write layer. */
export async function saveAdminTemplateAction(input: {
  eventId: RecordId
  key: string
  subject: string
  bodyMarkdown: string
}): Promise<ActionResult<{ template: AdminTemplateValue }>> {
  try {
    return actionOk({ template: await saveAdminTemplate(deps(), input) })
  } catch (error) {
    return actionFailure(error)
  }
}
