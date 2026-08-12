// The Sessionboard Public API, read side only. BUILD_SPEC 5.0e, Source B.
//
// Direction: inbound PULL. Every method here is a read, and there is no write method to
// call by accident: a second writer on the far side is what turns a one-way migration
// into the two-way sync nobody specified.
//
// THE TOKEN IS A CREDENTIAL. It arrives as a parameter, lives for the duration of the
// run, and is stored nowhere: not in an Airtable column, not in module state, not in an
// error context. Every `AppError` below carries the path and the status and never the
// header, because contexts reach log lines through `toLogLine()`.
//
// Region is a FIELD on the connection. An EU organization's data is not reachable from
// the US host, so one hardcoded host makes half the world's imports answer 401 with a
// token that is perfectly valid.

import { z } from 'zod'

import { AppError, ErrorIds } from '@/constants/errorIds'

export const SESSIONBOARD_REGIONS = ['us', 'eu'] as const
export type SessionboardRegion = (typeof SESSIONBOARD_REGIONS)[number]

export const SESSIONBOARD_BASE_URLS: Record<SessionboardRegion, string> = {
  us: 'https://public-api.sessionboard.com',
  eu: 'https://public-api-eu.sessionboard.com',
}

export const SESSIONBOARD_REGION_LABELS: Record<SessionboardRegion, string> = {
  us: 'United States',
  eu: 'Europe',
}

/** Their ceiling is 100; anything smaller only multiplies round trips. */
const PAGE_SIZE = 100

/** A stop on runaway pagination: 20,000 rows is far past any conference, so reaching it
 * means a repeated page. Without it a `totalPages` that never advances holds the run. */
const MAX_PAGES = 200

const REQUEST_TIMEOUT_MS = 20_000

/** Integers on events, uuids elsewhere. One key type, or every join misses. */
const remoteId = z.union([z.string(), z.number()]).transform(String)

/** `track`, `format`, `level`, `language` and `room` type as objects but serialise as a
 * bare name on some lists. Normalised to one shape here: branching on `typeof` at each
 * call site downstream is how one of the five ends up written as `[object Object]`. */
const lookupRef = z
  .union([z.string(), z.number(), z.object({ id: remoteId.nullish(), name: z.string().nullish() })])
  .transform((value) =>
    typeof value === 'object' ? value : { id: undefined, name: String(value) },
  )

export const sessionboardLookupSchema = z.object({
  id: remoteId,
  name: z.string().nullish(),
  color: z.string().nullish(),
  sort_order: z.number().nullish(),
})

export const sessionboardEventSchema = z.object({
  id: remoteId,
  name: z.string().nullish(),
  timezone: z.string().nullish(),
})

/** Field for field very nearly bodo's `Speaker`, and it carries `email`, so an imported
 * Sessionboard speaker is portal-ready the moment the run finishes. */
export const sessionboardContactSchema = z.object({
  id: remoteId,
  email: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  full_name: z.string().nullish(),
  photo_url: z.string().nullish(),
  company_name: z.string().nullish(),
  title: z.string().nullish(),
  about: z.string().nullish(),
  phone_mobile: z.string().nullish(),
  website_url: z.string().nullish(),
  linkedin_url: z.string().nullish(),
  twitter_url: z.string().nullish(),
  facebook_url: z.string().nullish(),
  honorific: z.string().nullish(),
  salutation: z.string().nullish(),
  pronouns: z.string().nullish(),
  gender: z.string().nullish(),
})

/** Sessions 2.0's flat participant list. Their own document calls `speakers`,
 * `chairpersons` and `moderators` "legacy junction-table" arrays kept for backwards
 * compatibility: reading those loses every custom role and every ordering, and
 * double-counts anyone who appears in two of the three. */
export const sessionboardParticipantSchema = z.object({
  id: remoteId.nullish(),
  contact_id: remoteId.nullish(),
  role: z.string().nullish(),
  is_primary: z.boolean().nullish(),
  sort_order: z.number().nullish(),
  contact: sessionboardContactSchema.nullish(),
})

export const sessionboardSessionSchema = z.object({
  id: remoteId,
  title: z.string().nullish(),
  description: z.string().nullish(),
  /**
   * "True for CFP abstract submissions; false for program sessions", which is exactly
   * bodo's `reviewRequired` split. Imported, never inferred from status: an accepted
   * abstract and a program session share a status and differ only here.
   */
  is_abstract: z.boolean().nullish(),
  status: z.string().nullish(),
  starts_at: z.string().nullish(),
  ends_at: z.string().nullish(),
  track: lookupRef.nullish(),
  tags: z.array(lookupRef).default([]),
  format: lookupRef.nullish(),
  level: lookupRef.nullish(),
  language: lookupRef.nullish(),
  room: lookupRef.nullish(),
  participants: z.array(sessionboardParticipantSchema).default([]),
  custom_fields: z.record(z.string(), z.unknown()).nullish(),
})

export type SessionboardEvent = z.infer<typeof sessionboardEventSchema>
export type SessionboardContact = z.infer<typeof sessionboardContactSchema>
export type SessionboardParticipant = z.infer<typeof sessionboardParticipantSchema>
export type SessionboardSession = z.infer<typeof sessionboardSessionSchema>
export type SessionboardLookup = z.infer<typeof sessionboardLookupSchema>

/** The event-settings reads, already typed on their side, so no mapping step. */
export const SESSIONBOARD_SETTINGS = [
  'tracks',
  'tags',
  'formats',
  'levels',
  'languages',
  'rooms',
  'session-statuses',
  'fields',
] as const
export type SessionboardSetting = (typeof SESSIONBOARD_SETTINGS)[number]

export type SessionboardConnection = {
  region: SessionboardRegion
  /** Organization API token, `x-access-token`. Never persisted, never logged. */
  token: string
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type SessionboardClient = {
  listEvents(): Promise<readonly SessionboardEvent[]>
  searchSessions(eventId: string): Promise<readonly SessionboardSession[]>
  listSpeakers(eventId: string): Promise<readonly SessionboardContact[]>
  listContacts(eventId: string): Promise<readonly SessionboardContact[]>
  listSetting(eventId: string, setting: SessionboardSetting): Promise<readonly SessionboardLookup[]>
}

/** `{results, pagination}`, and `results` "(not `data`)" is flagged in their own search
 * description. Both keys are accepted because the flag exists at all: an endpoint
 * answering under the other name imports as zero rows, with a successful run and no
 * error, which is the worst shape a bug can take here. */
function envelope<T extends z.ZodType>(row: T) {
  return z.object({
    results: z.array(row).nullish(),
    data: z.array(row).nullish(),
    pagination: z.object({ totalPages: z.number().nullish() }).nullish(),
  })
}

/** Three stop conditions, because each alone has a hole: a missing `pagination` block
 * loops on the count, a `totalPages` that over-reports fetches empty pages to MAX_PAGES,
 * and a short page is the only signal some list endpoints give. */
function isLastPage(rows: number, page: number, totalPages: number | null | undefined): boolean {
  if (rows === 0 || rows < PAGE_SIZE) return true
  return typeof totalPages === 'number' && page >= totalPages
}

export function createSessionboardClient(
  connection: SessionboardConnection,
  fetchImpl?: FetchLike,
): SessionboardClient {
  const transport = fetchImpl ?? fetch
  const root = SESSIONBOARD_BASE_URLS[connection.region]

  async function send(path: string, method: 'GET' | 'POST'): Promise<unknown> {
    let response: Response
    try {
      response = await transport(`${root}${path}`, {
        method,
        headers: {
          'x-access-token': connection.token,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        // The search takes its filters in the body; the import wants everything, so the
        // body is empty rather than absent, which their 3.1 document requires on a POST.
        body: method === 'POST' ? '{}' : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown'
      throw new AppError(ErrorIds.NET_UNAVAILABLE, `sessionboard transport failed: ${reason}`, {
        path,
        reason,
        region: connection.region,
      })
    }

    if (!response.ok) throw await failure(response, path, connection.region)
    const text = await response.text()
    if (text === '') return {}
    try {
      return JSON.parse(text)
    } catch {
      throw new AppError(ErrorIds.NET_BAD_SHAPE, 'sessionboard returned a non-JSON body', {
        path,
        body: text.slice(0, 300),
      })
    }
  }

  /** Pages to completion before returning, the same rule 3.1 imposes on Airtable. A
   * half-paginated list is a permanently wrong answer that looks correct, and here it
   * would be written into the base as a finished import. */
  async function listAll<T extends z.ZodType>(
    path: string,
    row: T,
    method: 'GET' | 'POST' = 'GET',
  ): Promise<readonly z.infer<T>[]> {
    const schema = envelope(row)
    const collected: z.infer<T>[] = []

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const query = `${path.includes('?') ? '&' : '?'}page=${page}&pageSize=${PAGE_SIZE}`
      const parsed = schema.safeParse(await send(`${path}${query}`, method))
      if (!parsed.success) {
        throw new AppError(ErrorIds.NET_BAD_SHAPE, 'sessionboard payload did not match', {
          path,
          page,
          issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.code}`),
        })
      }

      const rows = parsed.data.results ?? parsed.data.data ?? []
      collected.push(...rows)
      if (isLastPage(rows.length, page, parsed.data.pagination?.totalPages)) return collected
    }

    throw new AppError(ErrorIds.NET_BAD_SHAPE, 'sessionboard pagination did not terminate', {
      path,
      pages: MAX_PAGES,
      rows: collected.length,
    })
  }

  const scope = (eventId: string): string => `/v1/event/${encodeURIComponent(eventId)}`

  return {
    async listEvents() {
      return await listAll('/v1/events', sessionboardEventSchema)
    },
    async searchSessions(eventId) {
      // POST, not GET: the search is the only session endpoint carrying filters and
      // `expand`, which is what returns participants in the same pass as the rows.
      return await listAll(`${scope(eventId)}/sessions`, sessionboardSessionSchema, 'POST')
    },
    async listSpeakers(eventId) {
      return await listAll(`${scope(eventId)}/speakers`, sessionboardContactSchema)
    },
    async listContacts(eventId) {
      return await listAll(`${scope(eventId)}/contacts`, sessionboardContactSchema)
    },
    async listSetting(eventId, setting) {
      return await listAll(`${scope(eventId)}/${setting}`, sessionboardLookupSchema)
    },
  }
}

/** Split by status so the run row can say what the organizer has to fix. */
async function failure(response: Response, path: string, region: string): Promise<AppError> {
  const body = await response.text().catch(() => '')
  const context = { path, region, status: response.status, body: body.slice(0, 300) }

  if (response.status === 401 || response.status === 403) {
    return new AppError(ErrorIds.AUTH_TOKEN_INVALID, 'sessionboard rejected the token', context)
  }
  if (response.status === 404) {
    return new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'sessionboard: not found', context)
  }
  if (response.status === 429) {
    return new AppError(ErrorIds.NET_RATE_LIMITED, 'sessionboard rate limited the read', context)
  }
  if (response.status >= 500) {
    return new AppError(ErrorIds.NET_UNAVAILABLE, 'sessionboard is unavailable', context)
  }
  return new AppError(ErrorIds.NET_BAD_SHAPE, 'sessionboard rejected the read', context)
}
