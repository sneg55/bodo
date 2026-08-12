// The organizer's override of an AI pre-screen score, and how it is stored.
//
// BUILD_SPEC 5.4 gives the AI pre-screen a review row of its own, authored by the
// `ai@system` reviewer, kept out of the human average and labelled wherever it is shown.
// What was missing is the other half of the rubric item: a chair who disagrees with the
// machine had nowhere to say so. Every control on the submission detail acted on the
// SUBMISSION (accept, decline, notify, status, content); none of them acted on the review.
//
// WHERE IT IS STORED, and why it is not a new column. The override lives in the AI review's
// own `notesJson` blob under one reserved key, so:
//
//   - nothing is destroyed. The AI's `scores`, its rationale in `comment` and its
//     `recommendation` are left exactly as the model wrote them, which is what makes the
//     panel able to show "AI said 40%, the chair says 75%" rather than one number with a
//     history nobody can see.
//   - it is reversible. Clearing the override deletes the key and the row is the machine's
//     again.
//   - the schema is untouched. `notesJson` already exists on Reviews, already round-trips
//     through the mapper, and is already `Record<string, string>`.
//
// The reserved key cannot collide with a criterion. `criterionKey()` (plan-editor.ts)
// produces lowercase letters, digits and hyphens only, so no rubric can generate a key
// beginning with an underscore, and `toEntry` renders a note only when a `text` criterion
// of that key exists in the round.
//
// Pure and total: it parses a blob that came out of Airtable, so every malformed shape has
// an answer rather than a throw inside a cached read.

import type { ReviewRecommendation } from '@/constants/status'
import { isRecommendation } from '@/features/review/review-draft'

/** The one `notesJson` key an override occupies. Never a criterion key. See above. */
export const AI_OVERRIDE_KEY = '__aiOverride'

export type AiOverride = {
  /** The chair's own score for this submission, 0-100, as the surfaces render it. */
  readonly percent: number
  /** Their verdict, when they gave one. Absent leaves the AI's recommendation showing. */
  readonly recommendation?: ReviewRecommendation
  /** Why. Optional, and the panel shows it as the chair's own note beside the AI's. */
  readonly note?: string
  /** Who overrode it, already resolved to a display name. */
  readonly by: string
  /** When, ISO 8601. */
  readonly at: string
}

/**
 * A percent an organizer typed, or `undefined` when it is not one.
 *
 * Clamped rather than rejected at the edges, for the reason `scoring.ts` clamps a
 * out-of-range score: 105 typed into a percent box is a slip, not a different intention.
 * Anything that is not a number at all IS rejected, because there is nothing to guess.
 */
export function overridePercent(raw: string | number): number | undefined {
  const value = typeof raw === 'number' ? raw : Number(raw.trim())
  if (raw === '' || !Number.isFinite(value)) return undefined
  return Math.round(Math.min(Math.max(value, 0), 100))
}

function toRecommendation(value: unknown): ReviewRecommendation | undefined {
  return typeof value === 'string' && isRecommendation(value) ? value : undefined
}

/** The override on a review's notes, or nothing. Total: a malformed blob is no override. */
export function readAiOverride(
  notes: Readonly<Record<string, string>> | undefined,
): AiOverride | undefined {
  const raw = new Map(Object.entries(notes ?? {})).get(AI_OVERRIDE_KEY)
  if (raw === undefined || raw.trim() === '') return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined

  const held = new Map(Object.entries(parsed as Record<string, unknown>))
  const percent = held.get('percent')
  const by = held.get('by')
  const at = held.get('at')
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return undefined
  if (typeof by !== 'string' || typeof at !== 'string') return undefined

  const recommendation = toRecommendation(held.get('recommendation'))
  const note = held.get('note')
  return {
    percent: Math.round(Math.min(Math.max(percent, 0), 100)),
    by,
    at,
    ...(recommendation === undefined ? {} : { recommendation }),
    ...(typeof note === 'string' && note.trim() !== '' ? { note: note.trim() } : {}),
  }
}

/** The notes blob to write when an override is set. Every other note is carried through. */
export function withAiOverride(
  notes: Readonly<Record<string, string>> | undefined,
  override: AiOverride,
): Record<string, string> {
  return { ...notes, [AI_OVERRIDE_KEY]: JSON.stringify(override) }
}

/** The notes blob to write when an override is cleared. */
export function withoutAiOverride(
  notes: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  // Rebuilt from entries rather than `delete`d off a copy: the same Map/entries discipline
  // every other blob in this feature is read through, and it keeps the key out of a
  // dynamic property position.
  return Object.fromEntries(Object.entries(notes ?? {}).filter(([key]) => key !== AI_OVERRIDE_KEY))
}
