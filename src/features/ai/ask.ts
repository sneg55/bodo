// What ⌘K asks for, and what it is allowed to do with the reply.
//
// Pure, and separate from the action that calls the model, because every rule worth
// getting right here is a rule about ids and strings rather than about Airtable or the
// network. All of it is testable with no key and no fetch.
//
// **The refs are the safety property, and they are the only reason this file exists.**
// The model answers in prose and cites record ids; nothing it writes becomes a link
// unless `resolveRefs` finds that exact id among the rows the snapshot was built from.
// An invented id, a real id copied out of a title, a speaker id arriving tagged as a
// submission: each resolves to nothing and is dropped. So the worst a hallucination can
// do is leave an answer with fewer rows under it than it deserved, never a link into a
// record that does not exist.
//
// **`snapshotRows` is what makes "the rows the snapshot was built from" precise.** The
// snapshot caps each section at `SNAPSHOT_LIMIT`, so the rows the caller read and the
// rows the model saw are not the same list on a large event. Resolving against the read
// would let an id past the cap resolve by luck, which is a link the model guessed rather
// than one it was shown.
//
// **The keyless answer lives in `ask-mock.ts`**, next door rather than here, and it is fed
// the same rows so that it cites only ids `resolveRefs` can resolve.

import type { EventSnapshot } from '@/features/ai/snapshot'
import { GROUP_LIMIT, speakerHref, submissionHref } from '@/features/search/global-search'
import type { Speaker, SubmissionWithParticipants } from '@/types/domain'
import type { GlobalSearchItem } from '@/types/search'

/** The two record kinds the palette can open. Anything else has nowhere to go. */
const KINDS = ['submission', 'speaker'] as const

export type AskRefKind = (typeof KINDS)[number]

/** One citation. An id, not an href: the server decides where an id may point. */
export type AskRef = { readonly kind: AskRefKind; readonly id: string }

export type AskAnswer = { readonly answer: string; readonly refs: readonly AskRef[] }

/** What `askEventAction` hands the palette. Here rather than in the `'use server'` file,
 * which may only export async functions. */
export type AskOutcome = {
  readonly answer: string
  readonly items: readonly GlobalSearchItem[]
  /** `isAiMocked()`. The palette says so; a sample presented as live is the one failure
   * the whole keyless path would otherwise introduce. */
  readonly mocked: boolean
  /**
   * `AI_SAMPLE_NOTICE`, carried across the wire rather than imported by the palette, and
   * empty when `mocked` is false.
   *
   * It looks like a field that should not exist, because the constant is exported and the
   * palette could just import it. It cannot: `@/services/ai` re-exports `liveClient`, so a
   * client component reaching for that one string pulls `@anthropic-ai/sdk` into the
   * browser bundle. Measured, not guessed: a 462 KB chunk landed in the client reference
   * manifest of every admin page. The wording still lives in exactly one place, which is
   * what the constant is for.
   */
  readonly mockNotice: string
  /** Snapshot sections that were capped, so a partial answer is never shown as whole. */
  readonly truncated: readonly string[]
}

/**
 * An answer belongs to exactly one question, and stops being shown when that stops being
 * the question.
 *
 * The in-flight half of this was already handled: a reply arriving for a question the
 * organizer has typed past is dropped rather than rendered. This is the half AFTER it
 * settles, and it needed its own rule. The answer sat in state and kept rendering while
 * the input changed underneath it, and because every answer row carries its question in
 * its cmdk `value`, SHORTENING the query into a prefix left the row matching and on
 * screen. An answer to a question nobody is asking any more is worse than no answer,
 * because it reads as a reply to the one they are asking now. Found by Codex review.
 *
 * Generic over the state shape so the pure rule lives here, next to the ask, rather than
 * inside the client component where it cannot be tested: `vitest` runs in `node` and this
 * project has no DOM test environment.
 */
export function askForQuestion<T extends { readonly question: string }>(
  state: T | undefined,
  question: string,
): T | undefined {
  return state?.question === question ? state : undefined
}

/**
 * Thinking AND the answer share this budget on `claude-opus-5`, so it is sized for both.
 * The answer itself is three sentences and at most eight short ref objects, which is a
 * few hundred tokens; the rest is headroom for a thinking block, because a cap sized for
 * the visible half truncates mid-object and lands as LLM_CONTEXT_OVERFLOW instead of as
 * an answer.
 */
export const ASK_MAX_TOKENS = 4096

/**
 * Below this a query is a search, not a question.
 *
 * `Ask "kub"` on top of the results would offer to spend a model call on a prefix the
 * organizer is still typing, and the answer would be worse than the substring match
 * already sitting underneath it. Long enough to be a phrase, short enough that
 * `no bios yet` qualifies.
 */
export const MIN_ASK_LENGTH = 8

/**
 * Above this a question stops being a question and starts being a payload.
 *
 * Derived from its neighbours rather than picked round. At the usual four characters a
 * token this is about 250 tokens: a sixteenth of `ASK_MAX_TOKENS`, which is the budget the
 * model gets for its own thinking plus the answer, and a rounding error next to a snapshot
 * carrying up to `SNAPSHOT_LIMIT` rows in each of two sections. So the snapshot stays the
 * only large thing in the request, by design, and no question can be the term that pushes
 * one over the context window. It is also four times the longest sentence in
 * `ASK_SYSTEM_PROMPT`, which is far more than anyone types into a one-line palette field.
 */
export const MAX_ASK_LENGTH = 1000

/**
 * Both bounds as one answer: the message to raise, or `undefined` when the question is
 * askable. Trim before calling.
 *
 * Here rather than inline in `askEventAction` because a `'use server'` module cannot be
 * imported from a test, and the upper bound is the half nobody would notice regressing:
 * an oversized request fails as `LLM_CONTEXT_OVERFLOW` only after it has been paid for.
 */
export function askLengthProblem(question: string): string | undefined {
  if (question.length < MIN_ASK_LENGTH) {
    return `Ask a question of at least ${MIN_ASK_LENGTH} characters.`
  }
  if (question.length > MAX_ASK_LENGTH) {
    return `Ask a question of at most ${MAX_ASK_LENGTH} characters.`
  }
  return undefined
}

export const ASK_SYSTEM_PROMPT = [
  'You answer questions about one conference event for the organizer running it.',
  '',
  'Everything you know about this event is in the snapshot. Never use outside knowledge and never estimate a number you cannot count in it. If the snapshot does not settle the question, say so plainly rather than guessing.',
  'A heading that says a section is capped means rows are missing. Say that your answer covers only the rows you were given.',
  '',
  'Answer in at most three sentences of plain text. No markdown, no lists, no headings.',
  '',
  'In `refs`, cite the records the answer is about, most relevant first. An id is the first field on a record line: copy it exactly, take submission ids only from the Submissions section and speaker ids only from the Speakers section.',
  'Never invent an id and never reshape one. An id that was not in the snapshot is dropped before the organizer sees it, so a made-up citation shows them nothing at all.',
  `Cite at most ${GROUP_LIMIT} records. Cite none when the answer is a count with no particular rows behind it.`,
].join('\n')

/**
 * `output_config.format`. Mirrors `AskAnswer`, which `readAskAnswer` then re-checks.
 *
 * **No `maxItems` on `refs`, and it is not an oversight.** Structured output refuses the
 * keyword outright: the API answers `400 invalid_request_error` with
 * `output_config.format.schema: For 'array' type, property 'maxItems' is not supported`,
 * which means every single ask failed the moment AI_MOCK went to 0. The cap is not lost,
 * because it was never enforced here in the first place: `askGroups` stops at
 * `GROUP_LIMIT` while building the group (see the break below), and the system prompt asks
 * for at most that many. So the schema keyword was belt-and-braces that happened to be
 * fatal, and the belt is the code that renders the result.
 */
export const ASK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'At most three plain-text sentences.' },
    refs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...KINDS] },
          id: { type: 'string', description: 'A record id copied from the snapshot.' },
        },
        required: ['kind', 'id'],
        additionalProperties: false,
      },
    },
  },
  required: ['answer', 'refs'],
  additionalProperties: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAskRef(value: unknown): value is AskRef {
  if (!isRecord(value)) return false
  const { kind, id } = value
  return typeof id === 'string' && id !== '' && KINDS.some((known) => known === kind)
}

/**
 * Read the reply into the shape the palette renders.
 *
 * A JSON schema is a request, not a guarantee: `parseAiMessage` proves the response is an
 * object and stops there. Everything below reads properties off it, and a `refs` that
 * arrived as a string would throw a TypeError inside a Server Action, which reaches the
 * browser as a redacted digest. Malformed entries are dropped for the same reason an
 * unresolvable id is: there is nothing useful to render for one.
 */
export function readAskAnswer(raw: unknown): AskAnswer {
  const record = isRecord(raw) ? raw : {}
  const refs = Array.isArray(record.refs) ? record.refs : []
  return {
    answer: typeof record.answer === 'string' ? record.answer.trim() : '',
    refs: refs.filter(isAskRef).map((ref) => ({ kind: ref.kind, id: ref.id })),
  }
}

export type AskRows = {
  readonly submissions: readonly SubmissionWithParticipants[]
  readonly speakers: readonly Speaker[]
}

/**
 * Narrow the rows the caller read to the rows the snapshot actually carried.
 *
 * `buildEventSnapshot` reports exactly what went in, so this needs no knowledge of the
 * cap or of how the sections are ordered. Without it, `resolveRefs` on an event with more
 * than `SNAPSHOT_LIMIT` submissions would happily resolve an id the model never saw.
 */
export function snapshotRows(input: { ids: EventSnapshot['ids'] } & AskRows): AskRows {
  const submissions = new Set(input.ids.submissions)
  const speakers = new Set(input.ids.speakers)
  return {
    submissions: input.submissions.filter((row) => submissions.has(row.id)),
    speakers: input.speakers.filter((row) => speakers.has(row.id)),
  }
}

// Citation resolution moved to ./ask-refs.ts when this file reached the 300 line limit.
// It is re-exported rather than re-pointed at every call site, because `resolveRefs` and
// `speakerName` are part of what asking a question means to the rest of the app; the split
// is about the size of this file, not about the shape of that seam.
export { resolveRefs, speakerName } from '@/features/ai/ask-refs'
