// The reads a template preview needs, with the authorization in front.
//
// Split from `./template-preview.ts`, which is the pure renderer, in the same shape and for
// the same stated reason as `./template-write.ts`: the interesting property here is an ORDER
// (refuse before reading), and an implementation that reached for `requireEventRole` and the
// DAL itself could only be checked by driving a real session through a real base. The deps
// are resolved in `./template-deps.ts` and nowhere else.
//
// Three rules, and the first is the security one:
//
//   1. `requireAdmin` runs FIRST, before the key is looked at and before the event or the
//      roster is read. A Server Action is reachable by POST with no layout ever rendering
//      (BUILD_SPEC 4). The rendered body is the mail this event's speakers receive and the
//      roster read hands back a real speaker's NAME AND ADDRESS, so this is a read that has
//      to be authorized, at the same `admin` level as the save it sits beside: a reviewer
//      holds a role on the event and neither writes these emails nor needs the roster.
//   2. The key comes from the same closed list the save checks against. An unknown key has
//      no built-in body to fall back to, so there would be nothing to preview.
//   3. The recipient is a REAL speaker where the event has one, taken as the first row of
//      the event's own roster, so `{{speaker.firstName}}` resolves to a name the organizer
//      recognises. An empty roster falls back to `SAMPLE_PERSON` and the caller is told
//      which of the two it got, because a preview that quietly invents a person is a preview
//      an organizer could mistake for a message already addressed to somebody.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { editableTemplateFor } from '@/features/comms/template-keys'
import {
  type PreviewEvent,
  type PreviewPerson,
  previewLinkUrl,
  previewTemplate,
  type TemplatePreview,
} from '@/features/comms/template-preview'
import type { RecordId } from '@/types/domain'

export type TemplatePreviewDeps = {
  /** `requireEventRole(eventId, 'admin')`. Raises; it never returns a boolean. */
  requireAdmin: (eventId: RecordId) => Promise<void>
  getEvent: (eventId: RecordId) => Promise<PreviewEvent>
  /** The event's roster, for a real name to address the preview to. */
  listSpeakers: (eventId: RecordId) => Promise<readonly PreviewPerson[]>
  /** `appUrl()`, as a dep so a test does not need the env boundary configured. */
  appOrigin: () => string
}

export type PreviewTemplateInput = {
  eventId: RecordId
  /** Checked against the closed list. An unknown key is refused. */
  key: string
  /** The subject as it stands in the editor, saved or not. */
  subject: string
  /** The body as it stands in the editor, saved or not. */
  bodyMarkdown: string
}

/**
 * Render one template against this event, or say why not.
 *
 * Nothing is written and nothing is stored: previewing an unsaved body costs two cached
 * reads and leaves the row exactly as it was, which is what lets the editor render on every
 * keystroke-free open without an organizer worrying that looking at a template changes it.
 */
export async function previewAdminTemplate(
  deps: TemplatePreviewDeps,
  input: PreviewTemplateInput,
): Promise<TemplatePreview> {
  // Rule 1. Before the key check, before either read.
  await deps.requireAdmin(input.eventId)

  const meta = editableTemplateFor(input.key)
  if (meta === undefined) {
    throw new AppError(ErrorIds.MAIL_TEMPLATE_MISSING, 'that is not an editable template', {
      key: input.key,
      eventId: input.eventId,
    })
  }

  const [event, speakers] = await Promise.all([
    deps.getEvent(input.eventId),
    deps.listSpeakers(input.eventId),
  ])

  return previewTemplate({
    meta,
    subject: input.subject,
    bodyMarkdown: input.bodyMarkdown,
    event,
    // The first row with an address. A speaker record with no email cannot be addressed and
    // would render `{{speaker.email}}` from the sample anyway, so skipping it here keeps the
    // "real recipient" label honest rather than half true.
    recipient: speakers.find((person) => person.email.trim() !== ''),
    portalUrl: previewLinkUrl(meta, deps.appOrigin(), input.eventId),
  })
}
