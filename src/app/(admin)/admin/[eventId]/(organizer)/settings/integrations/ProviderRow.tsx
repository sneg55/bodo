'use client'

// One provider in the registry. Rendered from a descriptor, three times, and it never
// names a provider: everything on it comes off `ProviderRowModel`.
//
// The affordances are the vendor's, from docs/parity/external-references.md: a primary
// `Settings` (or `Connect`, when there is nothing to open yet) with the three-dot overflow
// to the right of it, and `Disconnect` inside that menu rather than beside it. A
// `DropdownMenu` because a hand-rolled one is a lint error and, more usefully, because
// Base UI owns the dismissal, focus and ARIA a menu needs.
//
// DIRECTION IS THE ROW'S REAL CONTENT. The two directions fail in opposite ways, so each
// one gets its own block carrying its own control name out of the registry: `Import` for a
// pull, `Sync now` for a push. They are never one button renamed.
//
// The push block shows the label and its state but not a button, and that is not an
// oversight: BUILD_SPEC 5.0d puts the page-level `Sync now` in the Controls section at the
// bottom, next to `Retry failed`, and two buttons opening the same confirmation would make
// the page look like it offers two different syncs.

import { MoreHorizontalIcon } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

import { DisconnectItem } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/DisconnectItem'
import { ImportHistory } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/ImportHistory'
import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import type {
  ProviderAction,
  ProviderConnection,
  ProviderRowModel,
} from '@/features/integrations/model'

/**
 * Why `Disconnect` cannot be pressed.
 *
 * Named rather than hidden. An organizer looking for the control the vendor's docs describe
 * should find it and be told where the state actually lives, instead of concluding bodo
 * cannot disconnect at all.
 */
const DISCONNECT_UNAVAILABLE =
  'This provider stores no connection between runs: its credentials are entered in the import wizard each time, so there is nothing here to disconnect.'

export type ProviderRowProps = {
  row: ProviderRowModel
  /** The in-page anchor of this provider's detail, for rows that have one. */
  detailHref?: string
  /** True when this provider declares `importWizard`, so its pull control has a route. */
  importable?: boolean
  /**
   * True when this provider's connection is a per-EVENT mapping somebody can edit.
   *
   * Derived by the list from `credentialScope === 'env'`, never from an id. Those are the
   * providers whose credential is deployment configuration and whose remote identity is
   * therefore kept per event on the Events row, which is a thing an organizer can set.
   *
   * It gates `Disconnect` only. The mapping is WRITTEN in the provider's Connection card,
   * not here, because that is the surface showing the fields it writes; a row that opened
   * the same dialog would be a second identical button on the same screen. A `perRun`
   * provider has no stored connection at all, so there is nothing for it to disconnect.
   */
  mappable?: boolean
}

export function ProviderRow({
  row,
  detailHref,
  importable = false,
  mappable = false,
}: ProviderRowProps) {
  // `useParams` reads the `[eventId]` this row is already rendered under, which is how the
  // import href is built without the page above passing an id down. `providerActions` takes
  // an `importHref` and would be the tidier place for it, but that is computed in
  // `features/integrations/reads.ts`, which is server-side and event-scoped, while the
  // wizard's location is a routing fact belonging to this tree. So the model keeps saying
  // the control is unrouted and the component supplies the route.
  const eventId = String(useParams<{ eventId: string }>().eventId)
  const importHref = importable
    ? `/admin/${eventId}/settings/integrations/import/${row.id}`
    : undefined

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.label}</span>
            <ConnectionBadge connection={row.connection} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{connectionDetail(row.connection)}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <PrimaryControl detailHref={detailHref} importHref={importHref} />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={`${row.label} options`} />}
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-72">
              {/* Grouped because `DropdownMenuLabel` is Base UI's `Menu.GroupLabel` and
                  throws outside a group, taking the whole route to the error boundary. */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{row.label}</DropdownMenuLabel>
                {mappable ? (
                  <DisconnectItem
                    eventId={eventId}
                    label={row.label}
                    connected={row.connection.kind === 'connected'}
                  />
                ) : (
                  <DropdownMenuItem disabled>Disconnect</DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              {!mappable && (
                <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">
                  {DISCONNECT_UNAVAILABLE}
                </p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Separator />

      <div className="grid gap-4 p-4 sm:grid-cols-2">
        {row.actions.map((action) => (
          <DirectionBlock key={action.direction} action={action} importHref={importHref} />
        ))}
      </div>

      <Separator />

      <ImportHistory runs={row.runs} label={row.label} />
    </div>
  )
}

/**
 * The one primary button on a row, and which one it is says where this provider's
 * connection is edited.
 *
 * A provider with a DETAIL SECTION gets `Settings`, always, including while it is
 * unconnected. Its Connection card is the form: it shows the stored mapping, the sandbox
 * state and the sync behaviour, and it carries `Connect` in its own header. Putting a
 * second `Connect` up here would be two identical buttons a screen apart, and the one on
 * the row would open a dialog editing fields the organizer cannot see behind it.
 *
 * `Settings` used to render only once a provider was connected, which left the unconnected
 * row with no way to reach the section explaining what it was missing. That was backwards:
 * the section is most useful exactly then.
 *
 * A provider with no detail section gets `Connect`, pointing at the import wizard, whose
 * credentials step IS its setup. Those are the `perRun` providers, which store nothing
 * between runs, so a form here would have nothing to save.
 */
function PrimaryControl({ detailHref, importHref }: { detailHref?: string; importHref?: string }) {
  const href = detailHref ?? importHref
  if (href === undefined) return null

  return (
    <ButtonLink href={href} variant="outline" size="sm">
      {detailHref === undefined ? 'Connect' : 'Settings'}
    </ButtonLink>
  )
}

function ConnectionBadge({ connection }: { connection: ProviderConnection }) {
  if (connection.kind === 'connected') return <Badge variant="secondary">Connected</Badge>
  if (connection.kind === 'per-run') return <Badge variant="outline">Asked for each import</Badge>
  return <Badge variant="outline">Not configured</Badge>
}

function connectionDetail(connection: ProviderConnection): string {
  if (connection.kind === 'connected') {
    return connection.detail === '' ? 'Connected.' : `Mapped to ${connection.detail}.`
  }
  if (connection.kind === 'per-run') {
    // Not a softened "not configured": there is no credential to store. The token is read
    // for the length of one run and `ImportRun` has deliberately no column for it.
    return 'Credentials are entered when an import starts and are never stored.'
  }
  return `Missing: ${connection.missing.join(', ')}.`
}

/**
 * One direction, with the control it gets.
 *
 * A pull renders its button; a push renders its label and defers to Controls below. Both
 * render the direction's description verbatim out of the registry, because "reads from the
 * provider and writes into this event" is the sentence that stops the two being confused.
 *
 * `importHref` wins over `action.href` for the pull, and takes the blocked reason down with
 * it. The model's reason ("configured and started in the import wizard, which is not part of
 * this route") was true while that route did not exist; leaving it under a working link
 * would tell an organizer the button does nothing while the button works.
 */
function DirectionBlock({ action, importHref }: { action: ProviderAction; importHref?: string }) {
  const isPull = action.direction === 'pull'
  const href = isPull ? (importHref ?? action.href) : action.href
  const blockedReason = href === undefined ? action.blockedReason : undefined

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-background p-3">
      <div className="flex items-center gap-2">
        <Badge variant={isPull ? 'outline' : 'secondary'}>{isPull ? 'Pull' : 'Push'}</Badge>
        <span className="text-sm font-medium">{action.label}</span>
      </div>
      <p className="text-xs text-muted-foreground">{action.description}</p>

      {isPull ? (
        <div className="mt-1">
          {href === undefined ? (
            <Button variant="outline" size="sm" disabled>
              {action.label}
            </Button>
          ) : (
            <ButtonLink href={href} variant="outline" size="sm">
              {action.label}
            </ButtonLink>
          )}
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Runs from Controls, below.</p>
      )}

      {blockedReason === undefined ? null : (
        <p className="text-xs text-muted-foreground">{blockedReason}</p>
      )}
    </div>
  )
}
