// Everything the Integrations page reads, composed in one place.
//
// A feature function rather than a page: `src/app/**` holds routes only, and a page that
// awaited five reads inline would be the one place the caching decisions were invisible.
// Every read below is a cached, tagged DAL call under `event:{id}:integrations`
// (`reads-imports.ts`, `accelevents-sync.ts`), so the page paints from cache and every
// control on it expires exactly that tag.
//
// Two things here are decisions rather than plumbing.
//
// The four reads run in PARALLEL because none of them feeds another. Sequential awaits
// would make the slowest screen in Settings the sum of four Airtable round trips against
// a base under a ~5 req/s cap (BUILD_SPEC 3.1), for no ordering anyone needs.
//
// The label lookups are CONDITIONAL on the mappings that exist. Resolving "which local
// record is this" needs the event's speakers, sessions and taxonomy, and on the common
// path today there are no mapping rows at all, so loading four more lists to label an
// empty table would be four round trips spent on nothing. This is also why they are list
// reads indexed in one pass rather than a lookup per row: a per-row fan-out is exactly
// what §3.1 exists to prevent.

import { formatInstant, remoteEventHref } from '@/features/integrations/format'
import { type ProviderRowModel, providerRow } from '@/features/integrations/model'
import type { IntegrationMapping } from '@/services/accelevents/sync-types'
import {
  listEventIntegrationMappings,
  listEventSyncLogs,
} from '@/services/airtable/accelevents-sync'
import type { SyncLogEntry } from '@/services/airtable/mapping-accelevents'
import {
  getEvent,
  listRooms,
  listSpeakers,
  listSubmissions,
  listTags,
  listTracks,
} from '@/services/airtable/queries'
import { listImportRuns } from '@/services/airtable/reads-imports'
import { INTEGRATION_PROVIDERS, integrationSettings } from '@/services/integrations/registry'

export type AccelConnection = {
  /** `Mock` or `Live`, read through `@/utils/env` inside the registry. Never process.env. */
  readonly mock: boolean
  readonly configured: boolean
  readonly missing: readonly string[]
  readonly eventUrl?: string
  readonly remoteEventId?: string
  readonly remoteHref?: string
}

export type MappingRow = {
  readonly id: string
  readonly entityLabel: string
  readonly localLabel: string
  readonly localHref?: string
  readonly remoteId: string
  readonly syncedText: string
}

export type SyncLogRowModel = {
  readonly id: string
  readonly entityLabel: string
  readonly localLabel: string
  readonly actionLabel: string
  readonly status: 'ok' | 'failed'
  readonly atText: string
  readonly error?: string
}

export type IntegrationsPage = {
  readonly rows: readonly ProviderRowModel[]
  readonly timeZone: string
  readonly connection: AccelConnection
  readonly mappings: readonly MappingRow[]
  readonly logs: readonly SyncLogRowModel[]
}

const ENTITY_LABEL = new Map<string, string>([
  ['speaker', 'Speaker'],
  ['submission', 'Session'],
  ['track', 'Track'],
  ['tag', 'Tag'],
  ['room', 'Room'],
  ['ticket_type', 'Ticket type'],
])

const ACTION_LABEL = new Map<string, string>([
  ['create', 'Create'],
  ['update', 'Update'],
  ['skip', 'Skip'],
])

export async function loadIntegrationsPage(eventId: string): Promise<IntegrationsPage> {
  const [event, runs, mappings, logs] = await Promise.all([
    getEvent(eventId),
    listImportRuns(eventId),
    listEventIntegrationMappings(eventId),
    listEventSyncLogs(eventId),
  ])

  const timeZone = event.timezone
  const remote = { eventUrl: event.accelEventUrl, eventId: event.accelEventId }
  const settings = integrationSettings()
  const labels = await loadLabels(eventId, [...mappings, ...logs])

  return {
    timeZone,
    rows: INTEGRATION_PROVIDERS.map((provider) =>
      providerRow(provider, settings, { remote, runs, timeZone }),
    ),
    connection: accelConnection(settings.accelevents, remote),
    mappings: mappings.map((mapping) => mappingRow(mapping, labels, eventId, timeZone)),
    logs: logs.map((entry) => syncLogRow(entry, labels, timeZone)),
  }
}

/**
 * The Connection card's half of the model.
 *
 * `configured` is the registry's predicate rather than a second copy of it here, so the
 * page and the provider row cannot disagree about whether Accelevents is ready. The mock
 * IS a configuration, not a missing one: with `ACCELEVENTS_MOCK=1` every call is served
 * in-repo and the whole flow runs.
 */
function accelConnection(
  accelevents: { hasApiKey: boolean; mock: boolean },
  remote: { eventUrl?: string; eventId?: string },
): AccelConnection {
  const provider = INTEGRATION_PROVIDERS.find((entry) => entry.id === 'accelevents')
  const state = provider?.configured({
    accelevents,
    sessionboard: {},
    sessionize: {},
  }) ?? { configured: false, missing: ['ACCELEVENTS_API_KEY'] }

  return {
    mock: accelevents.mock,
    configured: state.configured,
    missing: state.missing,
    eventUrl: remote.eventUrl,
    remoteEventId: remote.eventId,
    remoteHref: remoteEventHref(remote.eventUrl),
  }
}

/** Names for the local records the mappings and the log point at, by record id. */
type LocalLabels = ReadonlyMap<string, string>

async function loadLabels(
  eventId: string,
  rows: readonly { entityType: string; localId: string }[],
): Promise<LocalLabels> {
  const kinds = new Set(rows.map((row) => row.entityType))
  if (kinds.size === 0) return new Map()

  // Each list is read only when a row actually points at that kind. An event with two
  // track mappings and nothing else pays one read, not four.
  const [speakers, submissions, tracks, tags, rooms] = await Promise.all([
    kinds.has('speaker') ? listSpeakers(eventId) : [],
    kinds.has('submission') ? listSubmissions(eventId) : [],
    kinds.has('track') ? listTracks(eventId) : [],
    kinds.has('tag') ? listTags(eventId) : [],
    kinds.has('room') ? listRooms(eventId) : [],
  ])

  const labels = new Map<string, string>()
  for (const speaker of speakers) {
    labels.set(speaker.id, `${speaker.firstName} ${speaker.lastName}`.trim())
  }
  for (const submission of submissions) labels.set(submission.id, submission.title)
  for (const track of tracks) labels.set(track.id, track.name)
  for (const tag of tags) labels.set(tag.id, tag.name)
  for (const room of rooms) labels.set(room.id, room.name)
  return labels
}

/**
 * Where an organizer goes to see the local record.
 *
 * Only surfaces that EXIST are linked. There is no per-record admin route in this build,
 * so these point at the list that holds the record, and the two entity kinds with no list
 * at all (speakers, and the reserved `ticket_type` no table produces) get no link rather
 * than a link into a 404. A dead link in a diagnostic table is worse than none: it makes
 * the organizer doubt the row rather than the link.
 */
function localHref(entityType: string, eventId: string): string | undefined {
  if (entityType === 'submission') return `/admin/${eventId}/abstracts`
  if (entityType === 'track' || entityType === 'tag' || entityType === 'room') {
    return `/admin/${eventId}/settings/tags`
  }
  return undefined
}

/**
 * A record id is shown when no name resolves, and that is deliberate.
 *
 * A mapping whose local record has been deleted still has a row here, and "Unknown" would
 * hide the one piece of information that lets somebody find out what it was. The id is
 * also what the Airtable base is searchable by.
 */
function labelFor(labels: LocalLabels, localId: string): string {
  return labels.get(localId) ?? localId
}

function mappingRow(
  mapping: IntegrationMapping,
  labels: LocalLabels,
  eventId: string,
  timeZone: string,
): MappingRow {
  return {
    id: mapping.id,
    entityLabel: ENTITY_LABEL.get(mapping.entityType) ?? mapping.entityType,
    localLabel: labelFor(labels, mapping.localId),
    localHref: localHref(mapping.entityType, eventId),
    // As stored, prefix and all. `sessionize:14022` and a bare Accelevents id mean
    // different things and collapsing them would hide which provider wrote the row.
    remoteId: mapping.remoteId,
    syncedText: formatInstant(mapping.syncedAt, timeZone),
  }
}

function syncLogRow(entry: SyncLogEntry, labels: LocalLabels, timeZone: string): SyncLogRowModel {
  return {
    id: entry.id,
    entityLabel: ENTITY_LABEL.get(entry.entityType) ?? entry.entityType,
    localLabel: labelFor(labels, entry.localId),
    actionLabel: ACTION_LABEL.get(entry.action) ?? entry.action,
    status: entry.status,
    atText: formatInstant(entry.at, timeZone),
    error: entry.error,
  }
}
