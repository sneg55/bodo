// The registry, rendered.
//
// This file is the reason the page is a registry rather than three cards: it maps over
// whatever `INTEGRATION_PROVIDERS` contains and knows nothing else. A fourth provider adds
// an entry to that array and appears here with its directions, its connection state and
// its run history, without a line changing in this directory.
//
// The two per-provider facts it holds are both derived from a CAPABILITY rather than from
// an id, which is what keeps a provider's name out of the layout:
//
//   - which rows have a detail section to open, so `Settings` has somewhere to point;
//   - which rows have an import wizard behind their `Import` control, which is every
//     provider declaring `importWizard`. WHERE that wizard lives is `ProviderRow`'s to say,
//     because the route needs the `[eventId]` segment and this component is rendered by a
//     page that does not hand it one;
//   - which rows have a connection an organizer can EDIT here, which is every provider whose
//     credential is deployment-scoped. Those are the ones that keep remote identity per event
//     on the Events row, so there is something to write. A `perRun` provider stores nothing
//     between runs, so its Connect opens the wizard that asks for the credential rather than
//     a form with nothing to save.

import { ProviderRow } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/ProviderRow'
import type { ProviderRowModel } from '@/features/integrations/model'
import { hasCapability, integrationProvider } from '@/services/integrations/registry'

export function ProviderList({ rows }: { rows: readonly ProviderRowModel[] }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const provider = integrationProvider(row.id)
        return (
          <ProviderRow
            key={row.id}
            row={row}
            detailHref={hasCapability(provider, 'syncLog') ? `#${row.id}` : undefined}
            importable={hasCapability(provider, 'importWizard')}
            mappable={provider.credentialScope === 'env'}
          />
        )
      })}
    </div>
  )
}
