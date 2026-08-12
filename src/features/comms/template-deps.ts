// The dependencies the template read, write and preview take, resolved.
//
// Its own module rather than a helper inside `./template-actions.ts`, because that file is
// `'use server'`: every export there has to be an async function that is safe to expose as
// a POST endpoint, so a plain factory cannot live in it. Settings > Email Templates renders
// its rows on the SERVER and needs the same three, and going through an action to read them
// would mean a page fetching from itself.
//
// Resolved per call rather than once at module scope, and that is not style: a module-level
// object closing over anything request-shaped is exactly the long-lived isolate state the
// Workers rules forbid. These are three function references, so building them per call
// costs nothing.

import { requireEventRole } from '@/features/auth/wiring'
import type { TemplatePreviewDeps } from '@/features/comms/template-preview-load'
import type { TemplateWriteDeps } from '@/features/comms/template-write'
import { upsertEmailTemplate } from '@/services/airtable/mutations-comms'
import { getEvent, listEmailTemplates, listSpeakers } from '@/services/airtable/queries'
import { appUrl } from '@/utils/env'

/** `requireEventRole(eventId, 'admin')`, which every one of these starts with. */
const requireAdmin = async (eventId: string): Promise<void> => {
  await requireEventRole(eventId, 'admin')
}

export function templateDeps(): TemplateWriteDeps {
  return {
    requireAdmin,
    // The CACHED, tagged read, through the query boundary rather than out of reads-comms
    // directly: that is what makes it answer on a clone with no Airtable base, where the
    // fixture source returns no stored rows and every template is its built-in body. Going
    // straight to the live read threw `CFG_ENV_MISSING` from `getClient()` and left
    // Settings > Email Templates blank on the demo path. A save expires the tag, so what a
    // caller reads back after saving is what was stored.
    listTemplates: listEmailTemplates,
    // `'action'` because every entry point is a Server Action. The origin no longer selects
    // between invalidation APIs; see invalidate.ts on why it is still passed.
    save: (input) => upsertEmailTemplate(input, 'action'),
  }
}

/**
 * What the preview needs on top: the event, for `{{event.name}}`, and the roster, for a real
 * person to address it to.
 *
 * Both are the CACHED, tagged reads at the query boundary, for the reason the comment above
 * gives: they answer on a clone with no Airtable base, where the fixture source supplies the
 * event and its speakers and the preview renders exactly as it does against a live one.
 */
export function templatePreviewDeps(): TemplatePreviewDeps {
  return {
    requireAdmin,
    getEvent,
    listSpeakers,
    appOrigin: appUrl,
  }
}
