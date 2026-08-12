// Event Settings > Webhooks.
//
// The secret is dropped before the list crosses into the client component, and that is the
// point of the mapping rather than tidiness: the signing secret is not a digest but the live
// HMAC key, so a row handed whole to a client component is serialised into the RSC payload and
// readable by anyone who can view that tab's source. `WebhookListRow` is the type that makes
// forgetting impossible.
//
// `requireEventId` first, exactly as the API Tokens page does: the URL segment may be a slug
// or a record id, and every read and every action below is keyed on the record id.

import { requireEventId } from '@/features/events/resolve-ref'
import { isSettingsOrganizer } from '@/features/settings/authorize'
import { WebhooksPanel } from '@/features/webhooks/WebhooksPanel'
import { listWebhooks } from '@/services/airtable/reads-webhooks'

export const metadata = { title: 'Webhooks' }

export default async function WebhooksPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  // Renders nothing rather than redirecting: this page sits under `settings/loading.tsx`, and
  // a `redirect()` resolving after the shell has flushed is a hung request on Workers. The
  // layout above does the redirecting, and every action authorizes for itself regardless.
  if (!(await isSettingsOrganizer(eventId))) return null

  const webhooks = await listWebhooks(eventId)

  return (
    <WebhooksPanel
      eventId={eventId}
      webhooks={webhooks.map(({ secret: _secret, ...row }) => row)}
    />
  )
}
