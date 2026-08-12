// The Accelevents REST boundary. One-way: bodo pushes, and nothing is ever read
// back into app state except remote ids.
//
// Two things here are load-bearing and were wrong in an earlier version of the
// spec. Remote ids are event-scoped, so they live in the IntegrationMappings
// table rather than on the local record: the same speaker at two events has two
// Accelevents ids, which a column on Speakers cannot represent. And a duplicate
// speaker email is a documented distinct error rather than a generic 400, so it
// has to be recognised and turned into a lookup instead of a failure.
//
// The mock is not a shortcut, it is the demo path. Until a real test event and
// key exist, ACCELEVENTS_MOCK=1 routes every call to `mock.ts`, which records the
// payload so the whole accept-and-sync flow is demonstrable. The env schema
// requires the key whenever the flag is off, so the two cannot drift apart.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getEnv } from '@/utils/env'

const BASE_URL = 'https://api.accelevents.com'

/** Their code for "a speaker with this email already exists on this event". */
export const DUPLICATE_EMAIL_CODE = 4068906

export type SpeakerPayload = {
  firstName: string
  lastName: string
  email: string
  biography?: string
  company?: string
  headshotUrl?: string
}

export type SessionPayload = {
  title: string
  description?: string
  startTime: string
  endTime: string
  format?: string
  room?: string
  trackIds?: readonly string[]
  tagIds?: readonly string[]
  speakerIds?: readonly string[]
  ticketTypesThatCanBeRegistered?: readonly string[]
}

export type TaxonomyPayload = {
  type: 'TRACKS' | 'TAGS'
  name: string
}

/** What every call returns: the remote id, plus whether it already existed. */
export type RemoteRef = {
  remoteId: string
  existed: boolean
}

export type AccelClient = {
  createSpeaker(eventUrl: string, payload: SpeakerPayload): Promise<RemoteRef>
  updateSpeaker(eventUrl: string, remoteId: string, payload: SpeakerPayload): Promise<RemoteRef>
  findSpeakerByEmail(eventUrl: string, email: string): Promise<string | undefined>
  createSession(eventUrl: string, payload: SessionPayload): Promise<RemoteRef>
  updateSession(eventUrl: string, remoteId: string, payload: SessionPayload): Promise<RemoteRef>
  createTaxonomy(eventUrl: string, payload: TaxonomyPayload): Promise<RemoteRef>
}

type RequestOptions = {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  body?: unknown
}

function authHeaders(): Record<string, string> {
  const key = getEnv().ACCELEVENTS_API_KEY
  if (key === undefined) {
    // Unreachable when ACCELEVENTS_MOCK=1 routes to the mock, and the env schema
    // makes the key mandatory when the flag is off, so this is a guard against a
    // caller bypassing `getAccelClient()` rather than an expected path.
    throw new AppError(ErrorIds.ACCEL_AUTH_FAIL, 'ACCELEVENTS_API_KEY is not configured', {})
  }
  return { authorization: key, 'content-type': 'application/json' }
}

/** Bounded, so a hung integration cannot hold a Worker request open. */
const REQUEST_TIMEOUT_MS = 15_000

async function request<T>({ method, path, body }: RequestOptions): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // DNS, TLS, reset, and timeout arrive as a rejection rather than a response.
    // The retry sweep classifies by error id, so these have to become one, and
    // they are retryable by nature.
    const reason = error instanceof Error ? error.name : 'unknown'
    throw new AppError(ErrorIds.ACCEL_UNAVAILABLE, `accelevents transport failed: ${reason}`, {
      path,
      reason,
      timeoutMs: REQUEST_TIMEOUT_MS,
    })
  }

  const text = await response.text()

  if (!response.ok) {
    throw toAppError(response.status, text, path)
  }

  if (text === '') return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new AppError(ErrorIds.ACCEL_BAD_REQUEST, 'accelevents returned a non-JSON body', {
      path,
      body: text.slice(0, 300),
    })
  }
}

/**
 * Status codes are mapped to distinct error ids so a retry sweep can tell apart
 * "this will never work" from "try again later". A duplicate email is neither: it
 * is a successful identification of an existing record, and `syncSpeaker` turns it
 * into a lookup.
 */
function toAppError(status: number, body: string, path: string): AppError {
  const context = { status, path, body: body.slice(0, 300) }

  if (extractErrorCode(body) === DUPLICATE_EMAIL_CODE) {
    return new AppError(ErrorIds.ACCEL_DUPLICATE_EMAIL, 'speaker email already exists', context)
  }
  if (status === 401 || status === 403) {
    return new AppError(ErrorIds.ACCEL_AUTH_FAIL, 'accelevents rejected the api key', context)
  }
  if (status === 429 || status >= 500) {
    return new AppError(
      ErrorIds.ACCEL_UNAVAILABLE,
      'accelevents is unavailable, retryable',
      context,
    )
  }
  return new AppError(ErrorIds.ACCEL_BAD_REQUEST, 'accelevents rejected the payload', context)
}

/** Their error bodies carry a numeric code; be tolerant about where. */
export function extractErrorCode(body: string): number | undefined {
  try {
    const parsed = JSON.parse(body) as { code?: unknown; errorCode?: unknown }
    for (const candidate of [parsed.code, parsed.errorCode]) {
      if (typeof candidate === 'number') return candidate
      if (typeof candidate === 'string' && /^\d+$/.test(candidate)) return Number(candidate)
    }
  } catch {
    // Not JSON. Fall through to the substring check, because a plain-text body
    // still tells us which failure this is and that is the only thing we need.
  }
  return body.includes(String(DUPLICATE_EMAIL_CODE)) ? DUPLICATE_EMAIL_CODE : undefined
}

function idFrom(payload: unknown, existed: boolean): RemoteRef {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as { id?: unknown; speakerId?: unknown; sessionId?: unknown }
    for (const candidate of [record.id, record.speakerId, record.sessionId]) {
      if (typeof candidate === 'string' && candidate !== '') return { remoteId: candidate, existed }
      if (typeof candidate === 'number') return { remoteId: String(candidate), existed }
    }
  }
  throw new AppError(ErrorIds.ACCEL_BAD_REQUEST, 'accelevents response carried no id', {})
}

export const liveClient: AccelClient = {
  async createSpeaker(eventUrl, payload) {
    return idFrom(
      await request<unknown>({
        method: 'POST',
        path: `/rest/host/event/${encodeURIComponent(eventUrl)}/speaker`,
        body: payload,
      }),
      false,
    )
  },

  async updateSpeaker(eventUrl, remoteId, payload) {
    // An update returns the id we already sent, and their update endpoints are
    // documented as returning an empty 200. Parsing an id out of the response
    // turned every successful update into a failure, so the id comes from the
    // caller and the response only has to be non-error. See `updateSession` too.
    await request<unknown>({
      method: 'PUT',
      path: `/rest/host/event/${encodeURIComponent(eventUrl)}/speaker/${encodeURIComponent(remoteId)}`,
      body: payload,
    })
    return { remoteId, existed: true }
  },

  async findSpeakerByEmail(eventUrl, email) {
    const result = await request<{ speakers?: readonly { id?: unknown; email?: unknown }[] }>({
      method: 'GET',
      path: `/rest/host/event/${encodeURIComponent(eventUrl)}/speakers?search=${encodeURIComponent(email)}`,
    })
    const wanted = email.trim().toLowerCase()
    for (const speaker of result.speakers ?? []) {
      const found = typeof speaker.email === 'string' ? speaker.email.trim().toLowerCase() : ''
      if (found !== wanted) continue
      if (typeof speaker.id === 'string') return speaker.id
      if (typeof speaker.id === 'number') return String(speaker.id)
    }
    return undefined
  },

  async createSession(eventUrl, payload) {
    return idFrom(
      await request<unknown>({
        method: 'POST',
        path: `/rest/host/event/${encodeURIComponent(eventUrl)}/session`,
        body: payload,
      }),
      false,
    )
  },

  async updateSession(eventUrl, remoteId, payload) {
    await request<unknown>({
      method: 'PUT',
      path: `/rest/host/event/${encodeURIComponent(eventUrl)}/session/${encodeURIComponent(remoteId)}`,
      body: payload,
    })
    return { remoteId, existed: true }
  },

  async createTaxonomy(eventUrl, payload) {
    return idFrom(
      await request<unknown>({
        method: 'POST',
        path: `/rest/host/event/${encodeURIComponent(eventUrl)}/tag`,
        body: payload,
      }),
      false,
    )
  },
}
