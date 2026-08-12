// The Integrations page as data. No IO, no JSX, no React.
//
// The page is a PROVIDER REGISTRY (BUILD_SPEC 5.0d), so every row on it is derived from
// `INTEGRATION_PROVIDERS` by the functions here rather than written out three times. That
// is the whole point: a fourth provider is a descriptor, and three hand-written cards
// drift the way three hand-written tables did before `DataTable` existed.
//
// Pure so it is unit tested without an env, a token or a network (tests/integrations-page
// .test.ts). Everything that touches Airtable is in ./reads.ts and is a thin wrapper.
//
// The one thing here that is not bookkeeping is `providerActions`. `Sync now` and `Import`
// are never the same button with a different label, because the two directions fail in
// opposite ways: a misconfigured push writes wrong rows into somebody else's system, a
// misconfigured pull writes wrong rows into this event. So the actions are derived per
// DIRECTION, they carry the direction's own label and description out of the registry, and
// the one provider that offers both gets two of them.

import { formatInstant, hasText } from '@/features/integrations/format'
import {
  DIRECTION_DESCRIPTIONS,
  DIRECTION_LABELS,
  type IntegrationDirection,
  type IntegrationProvider,
  type IntegrationSettings,
} from '@/services/integrations/registry'
import {
  EMPTY_IMPORT_COUNT,
  IMPORT_PHASE_LABELS,
  type ImportCounts,
  type ImportEntityType,
  type ImportRun,
  type ImportSource,
  type ImportStatus,
} from '@/types/imports'

// Records indexed by a variable are what `security/detect-object-injection` exists to
// flag, and the whole codebase answers it the same way: build the Map once.
const DIRECTION_LABEL = new Map<IntegrationDirection, string>(
  Object.entries(DIRECTION_LABELS).map(([key, value]) => [key as IntegrationDirection, value]),
)
const DIRECTION_DESCRIPTION = new Map<IntegrationDirection, string>(
  Object.entries(DIRECTION_DESCRIPTIONS).map(([key, value]) => [
    key as IntegrationDirection,
    value,
  ]),
)
const PHASE_LABEL = new Map(Object.entries(IMPORT_PHASE_LABELS))

/** Authored. The vendor's docs describe no run history, so nothing here is transcribed. */
const RUN_STATUS_LABEL = new Map<ImportStatus, string>([
  ['queued', 'Queued'],
  ['running', 'Running'],
  ['done', 'Done'],
  ['failed', 'Failed'],
])

/**
 * How a provider answers "is this ready", and the three answers are genuinely different
 * problems with different fixes.
 *
 * `per-run` is not a softened `unconfigured`. A Sessionboard token is read for the length
 * of one run and stored nowhere (`ImportRun` has deliberately no credential column), so
 * there is no state to be in: the answer is `Asked for each import`, and telling an
 * organizer to go and configure something would send them looking for a settings field
 * that does not exist.
 */
export type ProviderConnection =
  | { readonly kind: 'connected'; readonly detail: string }
  | { readonly kind: 'per-run' }
  | { readonly kind: 'unconfigured'; readonly missing: readonly string[] }

export type ProviderAction = {
  readonly direction: IntegrationDirection
  /** `Import` or `Sync now`, out of the registry. Never renamed at a call site. */
  readonly label: string
  readonly description: string
  readonly enabled: boolean
  /** Why it is off, in a sentence. A disabled control with no reason is a dead one. */
  readonly blockedReason?: string
  /** Where `Import` goes. A pull is a wizard, not a one-click job: see `providerActions`. */
  readonly href?: string
}

export type ImportRunRow = {
  readonly id: string
  readonly status: ImportStatus
  readonly statusLabel: string
  readonly phaseLabel: string
  readonly whenText: string
  readonly countsText: string
  readonly error?: string
}

export type ProviderRowModel = {
  readonly id: ImportSource
  readonly label: string
  readonly directions: readonly IntegrationDirection[]
  readonly connection: ProviderConnection
  readonly actions: readonly ProviderAction[]
  readonly runs: readonly ImportRunRow[]
  /**
   * The stored remote identity, carried through so the Connect form can EDIT rather than
   * start over.
   *
   * Separate from `connection`, which answers "is this ready" and deliberately flattens the
   * mapping into one display string. Reopening the form on a connected provider has to
   * repopulate both fields, and `connection.detail` only ever held the URL, so an organizer
   * correcting a typo in the id would have silently cleared it.
   */
  readonly remote: RemoteEventRef
}

/**
 * The remote identity this event is mapped to, which is bodo's event-scoped stand-in for
 * the vendor's organization-level event mapping (BUILD_SPEC 5.0d records the deviation).
 */
export type RemoteEventRef = { readonly eventUrl?: string; readonly eventId?: string }

/**
 * Why `Import` is off on every row of this build.
 *
 * Stated rather than left blank, and pointing at where an import IS configured, because a
 * button that navigates to a route that does not exist is the same mistake as a `Sync now`
 * that 500s on a missing key: it fails after the click instead of explaining itself
 * before it.
 */
export const IMPORT_UNAVAILABLE =
  'Imports are configured and started in the import wizard, which is not part of this route. Runs already recorded appear below.'

/** What the Accelevents row is missing when the event has never been mapped to one. */
export const MISSING_REMOTE_EVENT = 'Accelevents event URL on this event'

export function providerConnection(
  provider: IntegrationProvider,
  settings: IntegrationSettings,
  remote: RemoteEventRef = {},
): ProviderConnection {
  // A perRun provider is answered BEFORE its own predicate is consulted, and that is not a
  // shortcut. The predicate answers "was this run given what it needs", and this page is
  // not a run: the snapshot it builds carries no token and no endpoint id, so the predicate
  // would always say `Not configured` and send an organizer looking for a settings field
  // that deliberately does not exist. `ImportRun` has no credential column on purpose.
  if (provider.credentialScope === 'perRun') return { kind: 'per-run' }

  const configured = provider.configured(settings)

  // Two separate facts, reported as one list, because an organizer fixes them in one
  // sitting and reporting them one at a time means two round trips: the credential is
  // deployment configuration, and the remote event is a per-event mapping. Only a provider
  // whose credential is deployment-scoped keys remote identity per event at all
  // (`Events.accelEventUrl`), which is why this is reached only past the branch above.
  const missing = [
    ...configured.missing,
    ...(hasText(remote.eventUrl) ? [] : [MISSING_REMOTE_EVENT]),
  ]
  if (missing.length > 0) return { kind: 'unconfigured', missing }

  return { kind: 'connected', detail: remote.eventUrl ?? '' }
}

/**
 * One control per direction, and never one control renamed.
 *
 * `importHref` is what a pull row navigates to. It is a parameter rather than a constant
 * because a pull is a WIZARD and not a job this page can start: BUILD_SPEC 5.0e's import
 * asks for a credential, previews, and has the organizer map categories before a single
 * record is written, so an `Import` button that fired a Server Action from here would be a
 * different feature wearing the same word. Passing `undefined` renders the control
 * disabled with the reason showing, which is the honest state while that route does not
 * exist; wiring it later is this one argument.
 */
export function providerActions(
  provider: IntegrationProvider,
  connection: ProviderConnection,
  importHref?: string,
): readonly ProviderAction[] {
  return provider.directions.map((direction) => {
    const base = {
      direction,
      label: DIRECTION_LABEL.get(direction) ?? direction,
      description: DIRECTION_DESCRIPTION.get(direction) ?? '',
    }
    if (direction === 'pull') {
      return importHref === undefined
        ? { ...base, enabled: false, blockedReason: IMPORT_UNAVAILABLE }
        : { ...base, enabled: true, href: importHref }
    }
    if (connection.kind === 'connected') return { ...base, enabled: true }
    return { ...base, enabled: false, blockedReason: unconfiguredReason(connection) }
  })
}

function unconfiguredReason(connection: ProviderConnection): string {
  if (connection.kind !== 'unconfigured') return 'This provider is not connected yet.'
  return `Not configured: ${connection.missing.join(', ')}.`
}

export function providerRow(
  provider: IntegrationProvider,
  settings: IntegrationSettings,
  input: {
    remote?: RemoteEventRef
    runs: readonly ImportRun[]
    timeZone: string
    importHref?: string
  },
): ProviderRowModel {
  const connection = providerConnection(provider, settings, input.remote ?? {})
  return {
    id: provider.id,
    label: provider.label,
    directions: provider.directions,
    connection,
    actions: providerActions(provider, connection, input.importHref),
    remote: input.remote ?? {},
    // `listImportRuns` is one read for the whole event, so the rows are partitioned here
    // rather than read per provider: three cached reads of the same table would cost three
    // round trips to answer a question one already answered.
    runs: input.runs
      .filter((run) => run.source === provider.id)
      .map((run) => importRunRow(run, input.timeZone)),
  }
}

export function importRunRow(run: ImportRun, timeZone: string): ImportRunRow {
  return {
    id: run.id,
    status: run.status,
    statusLabel: RUN_STATUS_LABEL.get(run.status) ?? run.status,
    phaseLabel: PHASE_LABEL.get(run.phase) ?? run.phase,
    whenText: runWhen(run, timeZone),
    countsText: countsText(run.counts),
    error: run.error,
  }
}

/**
 * When the run happened, in the event's timezone.
 *
 * A queued run has neither timestamp and says so instead of rendering an empty cell: it is
 * the row an organizer is actually waiting on, and a blank there reads as a broken record
 * rather than as work that has not started.
 */
function runWhen(run: ImportRun, timeZone: string): string {
  if (run.finishedAt !== undefined) return `Finished ${formatInstant(run.finishedAt, timeZone)}`
  if (run.startedAt !== undefined) return `Started ${formatInstant(run.startedAt, timeZone)}`
  return 'Not started yet'
}

/**
 * Created and updated and skipped, summed across entity types.
 *
 * Three numbers rather than one total, because the difference is the whole answer to "is
 * this re-run doing what I think": a second run of the same import should be almost all
 * updates, and a wall of creates means the idempotency key is not matching.
 */
export function countsText(counts: ImportCounts): string {
  const total = { ...EMPTY_IMPORT_COUNT }
  // `Object.values` rather than a keyed walk. `ImportCounts` is a Partial record, so
  // indexing it with a variable is an object-injection warning as well as an extra
  // undefined to carry; the values are the entity types that are actually present.
  for (const one of Object.values(counts)) {
    total.created += one.created
    total.updated += one.updated
    total.skipped += one.skipped
  }
  if (total.created + total.updated + total.skipped === 0) return 'Nothing recorded'
  return `${total.created} created, ${total.updated} updated, ${total.skipped} skipped`
}
