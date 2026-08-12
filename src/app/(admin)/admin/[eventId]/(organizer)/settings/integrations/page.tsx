// Event Settings > Integrations.
//
// A PROVIDER REGISTRY, not one integration's page with the others bolted on beside it
// (BUILD_SPEC 5.0d). Nothing below knows the word "Accelevents" except the section that is
// genuinely about it: the list renders `INTEGRATION_PROVIDERS`, so a fourth provider is a
// descriptor rather than a fourth bespoke card.
//
// A STATIC segment, so it wins over the `[section]` route next door that renders the
// out-of-scope card; `integrations` is off that card's list now (features/settings/nav.ts),
// which is what keeps the two from disagreeing about whether this exists.
//
// TWO AUDIENCES, and that is why this reads a role rather than a boolean. A reviewer may
// read the page, because chasing a session that never reached Accelevents means reading the
// sync log; only an admin may press either control, and that is enforced in the actions
// themselves rather than here. `canRun` below is a rendering decision only.
//
// It renders nothing rather than redirecting for an unauthorized caller, like every other
// settings page: the layout above reads the session in its own body and redirects before
// the first byte, and a `redirect()` from a page under a route-level `loading.tsx`
// resolves after the shell has flushed, which on Workers is a request the runtime cancels.

import { AccelSection } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/AccelSection'
import { ProviderList } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/ProviderList'
import { requireEventId } from '@/features/events/resolve-ref'
import { integrationsRole } from '@/features/integrations/authorize'
import { loadIntegrationsPage } from '@/features/integrations/reads'

export const metadata = { title: 'Integrations' }

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  const role = await integrationsRole(eventId)
  if (role === undefined) return null

  const page = await loadIntegrationsPage(eventId)

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        {/* `h2`, like every other settings page: the layout above already renders the
            `h1` ("Event Settings"), and a second one on the same document is two
            top-level headings for a screen reader to choose between. */}
        <h2 className="font-heading text-lg font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Where this event exchanges records with another system. Every provider states which
          direction it moves data in, because the two fail in opposite ways: a push writes rows into
          somebody else&apos;s system, a pull writes rows into this event.
        </p>
      </div>

      <ProviderList rows={page.rows} />

      <AccelSection
        eventId={eventId}
        connection={page.connection}
        mappings={page.mappings}
        logs={page.logs}
        canRun={role === 'admin'}
      />
    </div>
  )
}
