// Event Settings > Email Templates.
//
// It was one of six settings sections landing on the shared "not part of this build" card,
// and it was the odd one out: `EmailTemplates` has a full DAL, a resolver the senders
// already consult, and an editor that shipped inside the form builder's step 7. The only
// thing missing was a page that listed the rows.
//
// A STATIC segment, so it wins over the `[section]` route next door that renders the
// out-of-scope card; `email-templates` is off that card's list now, which is what keeps the
// two from disagreeing about whether this exists.
//
// The read goes through the write layer rather than the Server Action, because this is a
// server component and an action would be the page fetching from itself.
// `loadAdminTemplates` authorizes the READ as well as the write: an event's bodies name what
// its speakers were promised, and on a shared base they are not a stranger's business.

import { EmailTemplatesPanel } from '@/features/comms/EmailTemplatesPanel'
import { templateDeps } from '@/features/comms/template-deps'
import { ADMIN_TEMPLATES, SPEAKER_TEMPLATES } from '@/features/comms/template-keys'
import { loadAdminTemplates } from '@/features/comms/template-write'
import { requireEventId } from '@/features/events/resolve-ref'
import { isSettingsOrganizer } from '@/features/settings/authorize'

export const metadata = { title: 'Email Templates' }

export default async function EmailTemplatesPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  // Renders nothing rather than redirecting, like every other settings page: a redirect from
  // inside the `loading.tsx` boundary next door never produces a response on Workers.
  if (!(await isSettingsOrganizer(eventId))) return null

  const deps = templateDeps()
  const [speaker, admin] = await Promise.all([
    loadAdminTemplates(deps, eventId, SPEAKER_TEMPLATES),
    loadAdminTemplates(deps, eventId, ADMIN_TEMPLATES),
  ])

  return (
    <div className="flex flex-col gap-4">
      <div>
        {/* `h2`, like every other settings page: the layout above already renders the
            `h1` ("Event Settings"), and a second one on the same document is two top-level
            headings for a screen reader to choose between. */}
        <h2 className="font-heading text-lg font-semibold">Email Templates</h2>
        <p className="text-sm text-muted-foreground">
          The messages this event sends. Edit one to override the built-in wording; clear a body to
          go back to it.
        </p>
      </div>

      <EmailTemplatesPanel eventId={eventId} speaker={speaker} admin={admin} />
    </div>
  )
}
