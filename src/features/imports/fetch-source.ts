// The one place that picks a read client by `ImportSource`. BUILD_SPEC 5.0e.
//
// Everything above this file (the preview, the run engine, the phases) is written once
// and does not branch on provider: all three sources arrive as a `NormalizedImport`. All
// three ways of getting there live here, and nowhere else.
//
// The clients are INJECTED rather than constructed. Two reasons, and the second is the
// one that matters: a test drives the whole engine with fakes and never reaches the
// network, and a Sessionboard organization token is read for the duration of a run and
// stored nowhere (there is deliberately no credential column on `ImportRuns`), so the
// caller that HAS the token is the only thing that can build that client.
//
// `sourceRef` is the far side's identity and its shape is per source. It is parsed here
// because this is the only file that knows what each client needs:
//
//   sessionize    `<endpointId>`                 the id off their API / Embed page
//   sessionboard  `<region>:<eventId>`           region is `us` or `eu`
//   accelevents   `<eventId>:<eventUrl>`         a bare `<eventUrl>` is accepted
//
// It is NEVER a credential and never holds one.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import type { CategoryInput } from '@/features/imports/categories'
import {
  type AcceleventsPayload,
  type NormalizedImport,
  normalizeAccelevents,
  normalizeSessionboard,
  normalizeSessionize,
  type RoundTripGuard,
  type SessionboardPayload,
} from '@/features/imports/normalize'
import type { AccelReadClient, AccelSession } from '@/services/imports/accelevents-read'
import {
  SESSIONBOARD_REGIONS,
  type SessionboardClient,
  type SessionboardConnection,
  type SessionboardRegion,
} from '@/services/imports/sessionboard'
import type { SessionizeAll } from '@/services/imports/sessionize'
import type { ImportMapping, ImportSource } from '@/types/imports'

/**
 * What a fetch produced.
 *
 * `categories` is carried alongside the normalized payload rather than inside it because
 * only ONE source has them and only the wizard's mapping step reads them: Sessionize
 * categories are user-named and untyped beyond `session`/`speaker`, so the organizer
 * picks which bodo concept each one feeds. The other two type their taxonomies on their
 * own side and return an empty array here.
 */
export type SourceFetch = {
  normalized: NormalizedImport
  categories: readonly CategoryInput[]
}

/** What identifies the far side, plus the choices the organizer confirmed. */
export type SourceRequest = {
  source: ImportSource
  sourceRef: string
  mapping: ImportMapping
}

/**
 * The three clients, each optional.
 *
 * Optional rather than required because a caller legitimately has only some of them: a
 * cron sweep holds no Sessionboard token, so it cannot build that client at all, and a
 * missing client is a refusal to run that source rather than a crash halfway through it.
 * `fetchSource` reports the absence as `IMPORT_NO_CLIENT` and the sweep leaves the run
 * exactly as it found it.
 */
export type SourceClients = {
  sessionize?: (endpointId: string) => Promise<SessionizeAll>
  /**
   * Takes the REGION and returns a client, so the token stays in the caller's closure
   * and never crosses into the engine. `SessionboardConnection` pairs the two, and this
   * signature is deliberately the half of it that is safe to pass around.
   */
  sessionboard?: (region: SessionboardConnection['region']) => SessionboardClient
  accelevents?: () => AccelReadClient
}

export type SessionboardRef = { region: SessionboardRegion; eventId: string }
export type AcceleventsRef = { eventId?: string; eventUrl: string }

function isRegion(value: string): value is SessionboardRegion {
  return (SESSIONBOARD_REGIONS as readonly string[]).includes(value)
}

/**
 * `<region>:<eventId>`, and both halves are required.
 *
 * The region is a field on the connection rather than a constant because Sessionboard
 * serves two independent bases (`public-api` and `public-api-eu`), and an EU token
 * presented to the US host answers 401 rather than "wrong region", which is unreadable
 * from the run row. So it fails here, before the token is spent.
 */
export function parseSessionboardRef(sourceRef: string): SessionboardRef {
  const [region = '', eventId = ''] = sourceRef.trim().split(':', 2)
  if (!isRegion(region) || eventId.trim() === '') {
    throw new AppError(
      ErrorIds.DATA_SHAPE_INVALID,
      'sessionboard sourceRef must be region:eventId',
      {
        sourceRef,
      },
    )
  }
  return { region, eventId: eventId.trim() }
}

/**
 * `<eventId>:<eventUrl>`, or a bare `<eventUrl>`.
 *
 * The SCHEME is checked before the colon split, and that is the whole reason this is not
 * one line. A bare `https://events.accelevents.com/e/example` is the documented form, and
 * splitting it on the first colon produced `eventId: 'https'` plus a url of
 * `//events.accelevents.com/e/example`: the run then made every admin read against an
 * event literally called `https` and reported the refusal as a permissions problem.
 *
 * Below the scheme it is still the first colon, so an id-qualified ref keeps a url that
 * carries one (`99:https://host/e/x` is id `99`). The id is optional because §5.7 records
 * `accelEventUrl` on every synced event and `accelEventId` only sometimes; without the id
 * the admin reads cannot be addressed and the run falls back to the attendee-visible
 * session list, which brings no speakers. That degradation is reported as a warning
 * rather than taken silently.
 */
export function parseAcceleventsRef(sourceRef: string): AcceleventsRef {
  const trimmed = sourceRef.trim()
  if (trimmed === '') {
    throw new AppError(ErrorIds.DATA_SHAPE_INVALID, 'accelevents sourceRef is empty', {})
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return { eventUrl: trimmed }
  }

  const at = trimmed.indexOf(':')
  if (at === -1) return { eventUrl: trimmed }

  const eventId = trimmed.slice(0, at).trim()
  const eventUrl = trimmed.slice(at + 1).trim()
  if (eventUrl === '') {
    throw new AppError(ErrorIds.DATA_SHAPE_INVALID, 'accelevents sourceRef has no event url', {
      sourceRef,
    })
  }
  return { eventId: eventId === '' ? undefined : eventId, eventUrl }
}

function noClient(source: ImportSource): AppError {
  return new AppError(ErrorIds.CFG_ENV_MISSING, `no ${source} client was supplied`, { source })
}

/**
 * Fetch the far side and map it onto bodo's shapes.
 *
 * The `guard` is threaded through untouched and is only ever consulted by the Accelevents
 * mapper. It is built by the caller from `IntegrationMappings`, which keeps this file free
 * of DAL reads and keeps the normalizers pure.
 */
export async function fetchSource(
  request: SourceRequest,
  guard: RoundTripGuard,
  clients: SourceClients,
): Promise<SourceFetch> {
  if (request.source === 'sessionize') return await fetchSessionize(request, clients)
  if (request.source === 'sessionboard') return await fetchSessionboard(request, clients)
  return await fetchAccelevents(request, guard, clients)
}

async function fetchSessionize(
  request: SourceRequest,
  clients: SourceClients,
): Promise<SourceFetch> {
  const read = clients.sessionize
  if (read === undefined) throw noClient('sessionize')
  // One request for the `All` view and nothing else, so their five-minute response cache
  // is irrelevant to us and there is no per-view pagination to get wrong.
  const payload = await read(request.sourceRef.trim())
  return {
    normalized: normalizeSessionize(payload, request.mapping),
    categories: payload.categories,
  }
}

/**
 * Five reads, all paginated to completion by the client before it returns.
 *
 * Five, counted off the `Promise.all` below rather than off the endpoint list: sessions,
 * contacts, and one `listSetting` each for tracks, tags and rooms. This said six, which
 * matched nothing the function did and matches §5.0e's own "at least five paginated reads
 * on the far side" only by accident.
 *
 * `/contacts` rather than `/speakers`: both answer with Contacts, and the contact list is
 * the superset, so a participant whose contact was never promoted to a speaker on the far
 * side still resolves to a person here. `formats`, `levels` and `languages` are NOT read,
 * because bodo carries those three as text columns on the submission rather than as
 * lookup tables, and the session rows already name them.
 */
async function fetchSessionboard(
  request: SourceRequest,
  clients: SourceClients,
): Promise<SourceFetch> {
  const build = clients.sessionboard
  if (build === undefined) throw noClient('sessionboard')
  const ref = parseSessionboardRef(request.sourceRef)
  // The token is not on the run row and never was: whoever built this client holds it.
  const client = build(ref.region)

  const [sessions, contacts, tracks, tags, rooms] = await Promise.all([
    client.searchSessions(ref.eventId),
    client.listContacts(ref.eventId),
    client.listSetting(ref.eventId, 'tracks'),
    client.listSetting(ref.eventId, 'tags'),
    client.listSetting(ref.eventId, 'rooms'),
  ])

  const payload: SessionboardPayload = { sessions, contacts, tracks, tags, rooms }
  return { normalized: normalizeSessionboard(payload), categories: [] }
}

/**
 * Speakers plus sessions, with the documented fallback when the admin read is refused.
 *
 * The admin endpoints need event admin or staff access. When the enterprise key does not
 * have it on this event the read answers 401/403, which `accelevents-read.ts` raises as
 * `ACCEL_AUTH_FAIL` specifically so it stays distinguishable here. The attendee-visible
 * list is then used for sessions, and there is no attendee-visible speaker list at all,
 * so the run continues with the cast it can derive from the sessions and says so.
 */
async function fetchAccelevents(
  request: SourceRequest,
  guard: RoundTripGuard,
  clients: SourceClients,
): Promise<SourceFetch> {
  const build = clients.accelevents
  if (build === undefined) throw noClient('accelevents')
  const ref = parseAcceleventsRef(request.sourceRef)
  const client = build()

  const warnings: string[] = []
  let sessions: readonly AccelSession[] = []
  const speakers = await readAccelSpeakers(client, ref, warnings)

  if (ref.eventId !== undefined) {
    try {
      sessions = await client.listSessions(ref.eventId)
    } catch (error) {
      if (!isAuthRefusal(error)) throw error
      warnings.push('Accelevents refused the admin session list; read the public agenda instead.')
      sessions = await client.listPortalSessions(ref.eventUrl)
    }
  } else {
    sessions = await client.listPortalSessions(ref.eventUrl)
  }

  const payload: AcceleventsPayload = { speakers, sessions }
  const normalized = normalizeAccelevents(payload, guard)
  // Prepended, so a degraded read is the first thing on the preview rather than the last.
  return {
    normalized: { ...normalized, warnings: [...warnings, ...normalized.warnings] },
    categories: [],
  }
}

async function readAccelSpeakers(
  client: AccelReadClient,
  ref: AcceleventsRef,
  warnings: string[],
): Promise<readonly AccelSpeakerRow[]> {
  if (ref.eventId === undefined) {
    warnings.push(
      'No Accelevents event id, so the speaker list could not be read. Speakers come from the sessions only.',
    )
    return []
  }
  try {
    return await client.listSpeakers(ref.eventId)
  } catch (error) {
    if (!isAuthRefusal(error)) throw error
    warnings.push('Accelevents refused the speaker list. Speakers come from the sessions only.')
    return []
  }
}

type AccelSpeakerRow = Awaited<ReturnType<AccelReadClient['listSpeakers']>>[number]

/** The one status that means "try the weaker-privilege read", not "give up". */
function isAuthRefusal(error: unknown): boolean {
  return isAppError(error) && error.id === ErrorIds.ACCEL_AUTH_FAIL
}
