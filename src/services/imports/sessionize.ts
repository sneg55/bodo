// Sessionize's public read API. BUILD_SPEC 5.0e, Source A.
//
// Direction: inbound PULL only. There is no write endpoint here to get wrong, because
// the API is read-only and unauthenticated by design ("the data being accessed is
// essentially an event schedule, which is typically shared publicly").
//
// One request per run. `All` returns every array the import needs, so asking for
// `Sessions` and `Speakers` separately would only buy two chances to read either side
// of their five-minute cache and join a session list against a speaker list that was
// generated from a different snapshot.
//
// THE EMAIL LINE. The speaker object below has no `email` property and that is not an
// omission in this file: their payload does not carry one. Do not add a synthesised
// address here or anywhere downstream. See `normalize.ts` and `NeedsEmailRow`.

import { z } from 'zod'

import { AppError, ErrorIds } from '@/constants/errorIds'

export const SESSIONIZE_API_ROOT = 'https://sessionize.com/api/v2'

/** Bounded, so a hung far side cannot hold a Worker request open. */
const REQUEST_TIMEOUT_MS = 15_000

/**
 * TRAP 1, and it is the one that fails silently.
 *
 * `session.id` is a STRING in this document while `speaker.sessions[]` holds INTEGERS,
 * so the same identifier is typed two ways in one payload. Coerce both to string at the
 * boundary: a join written against the raw types compares `'14022'` with `14022`, matches
 * nothing, and produces an import where every session has no speakers and no error was
 * raised anywhere.
 *
 * A union with an explicit transform rather than `z.coerce.string()`, because coercion
 * would also turn `null` into the string `'null'` and hand the join a plausible-looking
 * key that points at nothing.
 */
const remoteId = z.union([z.string(), z.number()]).transform(String)

const sessionizeLinkSchema = z.object({
  title: z.string().nullish(),
  url: z.string().nullish(),
  linkType: z.string().nullish(),
})

const sessionizeAnswerSchema = z.object({
  questionId: remoteId.nullish(),
  question: z.string().nullish(),
  answerValue: z.string().nullish(),
})

/**
 * The whole of it. `id, firstName, lastName, fullName, bio, tagLine, profilePicture,
 * isTopSpeaker, links[], sessions[], categoryItems[], questionAnswers[]`, transcribed
 * from BUILD_SPEC 5.0e and confirmed against the live demo endpoint's field set.
 *
 * There is no email. There is no phone. There is no company as a first-class field
 * (their `tagLine` is a free-text line that often holds one, and guessing a company out
 * of it would be inventing data, so it lands on `tagline` and nowhere else).
 */
export const sessionizeSpeakerSchema = z.object({
  id: remoteId,
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  fullName: z.string().nullish(),
  bio: z.string().nullish(),
  tagLine: z.string().nullish(),
  profilePicture: z.string().nullish(),
  isTopSpeaker: z.boolean().nullish(),
  links: z.array(sessionizeLinkSchema).default([]),
  sessions: z.array(remoteId).default([]),
  categoryItems: z.array(remoteId).default([]),
  questionAnswers: z.array(sessionizeAnswerSchema).default([]),
})

/**
 * TRAP 3 lives on `status`: a SERVICE session carries `status: null` (the demo event's
 * `Lunch`). Typing it as a required string rejects the whole document at the boundary,
 * and typing it as a string with a default silently promotes furniture into the
 * programme. It is nullable, and `isServiceSession` is what the mapping branches on.
 */
export const sessionizeSessionSchema = z.object({
  id: remoteId,
  title: z.string().nullish(),
  description: z.string().nullish(),
  startsAt: z.string().nullish(),
  endsAt: z.string().nullish(),
  isServiceSession: z.boolean().nullish(),
  isPlenumSession: z.boolean().nullish(),
  speakers: z.array(remoteId).default([]),
  categoryItems: z.array(remoteId).default([]),
  questionAnswers: z.array(sessionizeAnswerSchema).default([]),
  roomId: remoteId.nullish(),
  room: z.string().nullish(),
  liveUrl: z.string().nullish(),
  recordingUrl: z.string().nullish(),
  status: z.string().nullish(),
  isInformed: z.boolean().nullish(),
  isConfirmed: z.boolean().nullish(),
})

export const sessionizeRoomSchema = z.object({
  id: remoteId,
  name: z.string().nullish(),
  sort: z.number().nullish(),
})

export const sessionizeCategoryItemSchema = z.object({
  id: remoteId,
  name: z.string().nullish(),
  sort: z.number().nullish(),
})

/**
 * TRAP 4. Categories are USER-NAMED and untyped beyond `session` / `speaker`. The demo
 * event's happen to be `Session format`, `Track`, `Level` and `Language`, and nothing in
 * the payload guarantees any of that, so nothing here may treat a title as a type. The
 * title only ever produces a SUGGESTION (`features/imports/categories.ts`) that the
 * organizer confirms in the wizard's mapping step.
 */
export const sessionizeCategorySchema = z.object({
  id: remoteId,
  title: z.string().nullish(),
  items: z.array(sessionizeCategoryItemSchema).default([]),
  sort: z.number().nullish(),
  type: z.enum(['session', 'speaker']).nullish(),
})

export const sessionizeQuestionSchema = z.object({
  id: remoteId,
  question: z.string().nullish(),
  questionType: z.string().nullish(),
  sort: z.number().nullish(),
})

export const sessionizeAllSchema = z.object({
  sessions: z.array(sessionizeSessionSchema).default([]),
  speakers: z.array(sessionizeSpeakerSchema).default([]),
  rooms: z.array(sessionizeRoomSchema).default([]),
  categories: z.array(sessionizeCategorySchema).default([]),
  questions: z.array(sessionizeQuestionSchema).default([]),
})

export type SessionizeSession = z.infer<typeof sessionizeSessionSchema>
export type SessionizeSpeaker = z.infer<typeof sessionizeSpeakerSchema>
export type SessionizeRoom = z.infer<typeof sessionizeRoomSchema>
export type SessionizeCategory = z.infer<typeof sessionizeCategorySchema>
export type SessionizeCategoryItem = z.infer<typeof sessionizeCategoryItemSchema>
export type SessionizeQuestion = z.infer<typeof sessionizeQuestionSchema>
export type SessionizeAll = z.infer<typeof sessionizeAllSchema>

/**
 * The transport, injected. Tests never reach the network, and the run engine can hand
 * in a fetch that is already inside its own timeout or retry budget.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type SessionizeOptions = {
  fetchImpl?: FetchLike
  /** Only `All` is used today; the parameter exists so a probe is not a code change. */
  view?: 'All'
}

/**
 * TRAP 2 is not enforceable here, it is a property of what the endpoint returns: ONLY
 * ACCEPTED SESSIONS EXIST. Drafts and rejects are never exposed, so a Sessionize import
 * can only ever produce accepted submissions and can never seed a review queue. The
 * status mapping records that (`features/imports/status-map.ts`) and the UI must not
 * offer a review step for this source.
 */
export async function fetchSessionizeAll(
  endpointId: string,
  options: SessionizeOptions = {},
): Promise<SessionizeAll> {
  const trimmed = endpointId.trim()
  if (trimmed === '') {
    throw new AppError(ErrorIds.NET_BAD_SHAPE, 'sessionize endpoint id is empty', {})
  }

  const transport = options.fetchImpl ?? fetch
  const url = `${SESSIONIZE_API_ROOT}/${encodeURIComponent(trimmed)}/view/${options.view ?? 'All'}`

  let response: Response
  try {
    response = await transport(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // DNS, TLS, reset and timeout arrive as a rejection rather than a response, so
    // without this they escape as a bare Error with no id for the run row to record.
    const reason = error instanceof Error ? error.name : 'unknown'
    throw new AppError(ErrorIds.NET_UNAVAILABLE, `sessionize transport failed: ${reason}`, {
      endpointId: trimmed,
      reason,
      timeoutMs: REQUEST_TIMEOUT_MS,
    })
  }

  const text = await response.text()

  if (!response.ok) {
    // A wrong endpoint id answers 404, and that is the single most likely thing an
    // organizer gets wrong, so it gets its own id rather than a generic read failure.
    const id = response.status === 404 ? ErrorIds.DATA_RECORD_NOT_FOUND : ErrorIds.NET_UNAVAILABLE
    throw new AppError(id, `sessionize rejected the read (${response.status})`, {
      endpointId: trimmed,
      status: response.status,
      body: text.slice(0, 300),
    })
  }

  return parseSessionizeAll(text, trimmed)
}

/**
 * Exported because the boundary is the interesting part and it is worth testing without
 * a transport at all. A non-JSON body is its own failure: Sessionize serves an HTML
 * error page when the endpoint's format is set to XML, which `JSON.parse` reports as an
 * unexpected token rather than as "you picked the wrong format".
 */
export function parseSessionizeAll(body: string, endpointId: string): SessionizeAll {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new AppError(ErrorIds.NET_BAD_SHAPE, 'sessionize returned a non-JSON body', {
      endpointId,
      hint: 'the endpoint format may be set to XML rather than JSON',
      body: body.slice(0, 300),
    })
  }

  const parsed = sessionizeAllSchema.safeParse(payload)
  if (!parsed.success) {
    throw new AppError(ErrorIds.NET_BAD_SHAPE, 'sessionize payload did not match', {
      endpointId,
      issues: parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.')}: ${issue.code}`),
    })
  }
  return parsed.data
}
