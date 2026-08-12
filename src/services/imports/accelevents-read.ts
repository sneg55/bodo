// Accelevents, read side. BUILD_SPEC 5.0e, Source C.
//
// Cheapest of the three to connect because there is nothing to connect: the key is
// already configured as ACCELEVENTS_API_KEY and the event identity is already on the
// event record. No token to paste, no endpoint id to create.
//
// UNVERIFIED, and flagged here rather than presented as fact: their published endpoint
// index documents `Create tag/tracks` and NOTHING that lists them back, while the
// session endpoints accept `tagIds` and `trackIds` as filters. So taxonomy has to be
// derived from expanded sessions, and whether `expand` actually hydrates tags and tracks
// has not been confirmed against a live event. If it does not, an Accelevents import
// brings sessions with no taxonomy at all. `normalize.ts` therefore degrades VISIBLY: it
// emits a preview warning naming the session count it found no taxonomy on, instead of
// importing a silently untagged programme.
//
// ALSO UNVERIFIED: the paths below. Only `{id, email}` on a speaker row is verified, and
// it is verified from this repo rather than from a doc page (`findSpeakerByEmail` in
// `src/services/accelevents/client.ts` parses exactly that). The index names the
// endpoints and their query parameters but not their URLs, so the paths are modelled on
// the `/rest/host/...` shape bodo's own write client already uses. They are constants
// below precisely so a 404 during the first live run is a one-line correction.
//
// Direction: PULL. This file never writes. The outbound push in
// `src/services/accelevents/client.ts` is a separate, frozen feature.

import { z } from 'zod'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getEnv } from '@/utils/env'

const BASE_URL = 'https://api.accelevents.com'
const PAGE_SIZE = 100
const MAX_PAGES = 200
const REQUEST_TIMEOUT_MS = 20_000

/** Inferred, not documented. See the header. */
export const ACCEL_READ_PATHS = {
  speakers: '/rest/host/speakers',
  sessions: '/rest/host/sessions',
  /** The lower-privilege fallback: any registered attendee may read it. */
  portalSessions: (eventUrl: string) =>
    `/rest/attendee/event/${encodeURIComponent(eventUrl)}/sessions`,
} as const

const remoteId = z.union([z.string(), z.number()]).transform(String)

/** Objects on an expanded read, bare names on a flat one. One shape downstream. */
const named = z
  .union([z.string(), z.object({ id: remoteId.nullish(), name: z.string().nullish() })])
  .transform((value) => (typeof value === 'object' ? value : { id: undefined, name: value }))

export const accelSpeakerSchema = z.object({
  id: remoteId,
  email: z.string().nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  name: z.string().nullish(),
  biography: z.string().nullish(),
  company: z.string().nullish(),
  headshotUrl: z.string().nullish(),
  profileImageUrl: z.string().nullish(),
})

export const accelSessionSchema = z.object({
  id: remoteId,
  title: z.string().nullish(),
  description: z.string().nullish(),
  startTime: z.string().nullish(),
  endTime: z.string().nullish(),
  format: z.string().nullish(),
  room: named.nullish(),
  tracks: z.array(named).default([]),
  tags: z.array(named).default([]),
  speakers: z.array(z.union([remoteId, accelSpeakerSchema])).default([]),
})

export type AccelSpeaker = z.infer<typeof accelSpeakerSchema>
export type AccelSession = z.infer<typeof accelSessionSchema>

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type AccelReadOptions = {
  fetchImpl?: FetchLike
  /**
   * Overridable for tests only. Production reads it through `src/utils/env.ts`, never
   * `process.env`: the env boundary is what makes a missing key a startup failure
   * instead of a 401 in the middle of a half-written import.
   */
  apiKey?: string
}

export type AccelReadClient = {
  listSpeakers(eventId: string): Promise<readonly AccelSpeaker[]>
  listSessions(eventId: string): Promise<readonly AccelSession[]>
  /** Fallback when the admin session read is refused. Keyed by event URL, not id. */
  listPortalSessions(eventUrl: string): Promise<readonly AccelSession[]>
}

/**
 * `{content, totalPages}` on some of their lists, a bare array on others, so both are
 * accepted. Rejecting the bare array would fail the read outright; assuming it would
 * silently import page one of a paged response and call the run finished.
 */
function envelope<T extends z.ZodType>(row: T) {
  return z.union([
    z.array(row),
    z.object({
      content: z.array(row).nullish(),
      data: z.array(row).nullish(),
      totalPages: z.number().nullish(),
    }),
  ])
}

function rowsOf<T>(
  parsed: readonly T[] | { content?: readonly T[] | null; data?: readonly T[] | null },
): {
  rows: readonly T[]
  totalPages: number | null | undefined
} {
  if (Array.isArray(parsed)) return { rows: parsed, totalPages: undefined }
  const page = parsed as {
    content?: readonly T[] | null
    data?: readonly T[] | null
    totalPages?: number | null
  }
  return { rows: page.content ?? page.data ?? [], totalPages: page.totalPages }
}

export function createAccelReadClient(options: AccelReadOptions = {}): AccelReadClient {
  const transport = options.fetchImpl ?? fetch

  function authHeader(): string {
    const key = options.apiKey ?? getEnv().ACCELEVENTS_API_KEY
    if (key === undefined || key === '') {
      throw new AppError(ErrorIds.ACCEL_AUTH_FAIL, 'ACCELEVENTS_API_KEY is not configured', {})
    }
    return key
  }

  async function send(path: string): Promise<unknown> {
    let response: Response
    try {
      response = await transport(`${BASE_URL}${path}`, {
        method: 'GET',
        headers: { authorization: authHeader(), accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown'
      throw new AppError(ErrorIds.ACCEL_UNAVAILABLE, `accelevents transport failed: ${reason}`, {
        path,
        reason,
      })
    }

    const text = await response.text()
    if (!response.ok) {
      const context = { path, status: response.status, body: text.slice(0, 300) }
      if (response.status === 401 || response.status === 403) {
        // The admin session read requires event admin or staff access. This is the
        // exact status that sends the run to `listPortalSessions`, so it has to stay
        // distinguishable from a generic rejection.
        throw new AppError(ErrorIds.ACCEL_AUTH_FAIL, 'accelevents refused the read', context)
      }
      if (response.status === 429 || response.status >= 500) {
        throw new AppError(ErrorIds.ACCEL_UNAVAILABLE, 'accelevents is unavailable', context)
      }
      throw new AppError(ErrorIds.ACCEL_BAD_REQUEST, 'accelevents rejected the read', context)
    }

    if (text === '') return []
    try {
      return JSON.parse(text)
    } catch {
      throw new AppError(ErrorIds.ACCEL_BAD_REQUEST, 'accelevents returned a non-JSON body', {
        path,
        body: text.slice(0, 300),
      })
    }
  }

  /** Pages to completion, same rule as everywhere else in this codebase. */
  async function listAll<T extends z.ZodType>(
    path: string,
    row: T,
  ): Promise<readonly z.infer<T>[]> {
    const schema = envelope(row)
    const collected: z.infer<T>[] = []

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const separator = path.includes('?') ? '&' : '?'
      // `expand` is what is supposed to hydrate tracks and tags onto a session. See the
      // header: that is the unverified part, and normalize.ts warns when it comes back dry.
      const query = `${separator}page=${page}&size=${PAGE_SIZE}&expand=true`
      const parsed = schema.safeParse(await send(`${path}${query}`))
      if (!parsed.success) {
        throw new AppError(ErrorIds.ACCEL_BAD_REQUEST, 'accelevents payload did not match', {
          path,
          page,
          issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.code}`),
        })
      }

      const { rows, totalPages } = rowsOf(parsed.data)
      collected.push(...rows)
      if (rows.length === 0 || rows.length < PAGE_SIZE) return collected
      if (typeof totalPages === 'number' && page + 1 >= totalPages) return collected
    }

    throw new AppError(ErrorIds.ACCEL_BAD_REQUEST, 'accelevents pagination did not terminate', {
      path,
      pages: MAX_PAGES,
      rows: collected.length,
    })
  }

  return {
    async listSpeakers(eventId) {
      const path = `${ACCEL_READ_PATHS.speakers}?eventId=${encodeURIComponent(eventId)}`
      return await listAll(path, accelSpeakerSchema)
    },
    async listSessions(eventId) {
      const path = `${ACCEL_READ_PATHS.sessions}?eventId=${encodeURIComponent(eventId)}`
      return await listAll(path, accelSessionSchema)
    },
    async listPortalSessions(eventUrl) {
      return await listAll(ACCEL_READ_PATHS.portalSessions(eventUrl), accelSessionSchema)
    },
  }
}
