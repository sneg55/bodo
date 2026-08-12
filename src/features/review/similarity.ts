// Near-duplicate detection across a round's abstracts (SPEC section 4): the reviewer facing
// two hundred submissions needs to be told "this one is 84% similar to SESS-142" instead of
// reading both cold and noticing on the second pass, or not at all. The cases are boring and
// real: a speaker who submitted twice, a resubmission of an abstract reviewed in an earlier
// round, two speakers who proposed one topic.
//
// Character-trigram cosine, and deliberately NOT a model call:
//
//   - Deterministic. The same two abstracts score the same today and after a model
//     deprecation, so a percentage quoted in a decision meeting still means what it meant.
//   - Instant and free. The sweep happens inside the read that was already loading the
//     abstracts: no API key, no rate limit, no cost, nothing to fail while a reviewer waits.
//   - It catches the actual cases. Trigrams over words because the failure mode is EDITING,
//     not paraphrase: a speaker who trims "Kubernetes" to "K8s" or fixes a typo breaks word
//     equality and barely moves a trigram profile. Same shape pg_trgm uses, padding included.
//
// Pure and total: no clock, no I/O, no throwing, no reads. It takes rows the caller has
// ALREADY loaded, which keeps it out of `src/services/airtable` and testable without a base.

import type { SubmissionWithParticipants } from '@/types/domain'

import { submissionDescription } from './abstract-text'

/**
 * The parts of a submission this module compares. Narrow for the reason `ScoredReview` in
 * `scoring.ts` is narrow: the full record would drag the Airtable shape into a module that
 * only counts trigrams. `text` is the abstract body as PLAIN TEXT, built by `similarityRow`
 * rather than read out of `answers` here: the body is an answer, not a column.
 */
export type SimilarityRow = { id: string; code: string; title: string; text: string }

/** One row scored against a target, as the panel renders it. `score` is 0-1, not a percent. */
export type SimilarNeighbour = { row: SimilarityRow; score: number }

export type SimilarPair = { a: SimilarityRow; b: SimilarityRow; score: number }

export type SimilarityOptions = {
  /** Pairs at or above this score are reported. Defaults to `DEFAULT_THRESHOLD`. */
  threshold?: number
  /** How many rows may be compared at all. Defaults to `DEFAULT_MAX_ROWS`. */
  maxRows?: number
}

/**
 * What the cap left out, returned rather than swallowed: a truncated comparison that reports
 * nothing reads exactly like a complete one that found nothing, and a reviewer who trusts "no
 * duplicates" on a half-compared round is the failure this cannot afford. Say it on screen.
 */
export type SimilarityCoverage = {
  /** Rows actually compared. */
  compared: number
  /** Rows the cap excluded before any comparison ran. */
  dropped: number
  /** Codes of those rows, in input order, so a caller can name them and not just count them. */
  droppedCodes: readonly string[]
}

export type SimilarPairsResult = SimilarityCoverage & { pairs: readonly SimilarPair[] }
export type SimilarToResult = SimilarityCoverage & { neighbours: readonly SimilarNeighbour[] }

/**
 * 0.55, and every digit of it is measured rather than picked. Two English abstracts on
 * unrelated topics do not score 0: they share `the`, ` in`, `ing` and every other common
 * fragment, so the floor for prose is high and a threshold near zero would report every pair
 * in the round. Against the fixtures in `tests/similarity.test.ts`: a retitled, lightly
 * edited resubmission scores 0.94 and the same abstract truncated scores 0.83; two talks
 * written independently on one topic score 0.57 to 0.59; unrelated abstracts of comparable
 * length score 0.43 to 0.48; two unrelated ONE-LINE texts sharing a stock opening score 0.54,
 * which is the real ceiling of the noise band and the reason the default is not 0.5.
 *
 * So 0.55 sits in the gap: above everything measured as unrelated, below the same-topic pair
 * the spec asks for. The gap is narrow and the weak spot is short text, where boilerplate is
 * most of the string, so a submission with a title and no abstract is where a false positive
 * will come from first. Lower the threshold per call to widen the net.
 */
export const DEFAULT_THRESHOLD = 0.55

/**
 * 400 rows, so at most 79,800 comparisons in `similarPairs`. O(n^2) inside a request: a
 * 2,000-submission round is 2 million comparisons against a Workers CPU budget shared with
 * everything else the page is doing. Anything past the cap is reported, not sliced off.
 */
export const DEFAULT_MAX_ROWS = 400

/**
 * Trigram counts for one text, sorted by trigram, plus the squared magnitude.
 *
 * Sorted because the dot product is a merge of two sorted lists, so the additions happen in
 * ascending trigram order whichever way round the arguments came. Summing in hash order
 * instead would make `similarity(a, b)` and `similarity(b, a)` differ in the last bit, and a
 * score that depends on argument order is a bug that surfaces only as a flaky sort.
 */
export type TextProfile = {
  entries: readonly { gram: string; count: number }[]
  /** Sum of squared counts. Squared, not the magnitude: see `profileSimilarity`. */
  normSquared: number
}

const EMPTY_PROFILE: TextProfile = { entries: [], normSquared: 0 }

/** Two spaces, pg_trgm style, so a one-character title still produces trigrams. */
const PAD = '  '

/**
 * Lowercase, punctuation to spaces, whitespace collapsed: one regex does all three, so
 * `"Scaling K8s: Lessons"` and `"scaling  k8s ... lessons"` normalise identically. Unicode
 * aware (`\p{L}`) rather than `[a-z0-9]`, because abstracts arrive in the language the session
 * is delivered in and stripping accents would reduce a French abstract to fragments that
 * match every other French abstract.
 */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * The comparable text: title then body. Both, because either alone misses a case. Titles
 * alone cannot tell two talks called "Observability in Practice" apart from two copies of one
 * talk; bodies alone miss the resubmission rewritten under a title kept word for word.
 */
export function rowText(row: SimilarityRow): string {
  return `${row.title} ${row.text}`
}

export function textProfile(text: string): TextProfile {
  const normalized = normalizeText(text)
  // Padding an empty string still yields trigrams of spaces, so every blank abstract would
  // match every other one at 100%, and a round mid-CFP is full of them. Empty text has no
  // profile: two people having typed nothing is not evidence that they typed the same thing.
  if (normalized.length === 0) return EMPTY_PROFILE

  const padded = `${PAD}${normalized}${PAD}`
  const counts = new Map<string, number>()
  for (let index = 0; index + 3 <= padded.length; index += 1) {
    const gram = padded.slice(index, index + 3)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }

  const entries = [...counts]
    .map(([gram, count]) => ({ gram, count }))
    .sort((left, right) => (left.gram < right.gram ? -1 : 1))
  let normSquared = 0
  for (const entry of entries) normSquared += entry.count * entry.count
  return { entries, normSquared }
}

/**
 * Cosine of two trigram profiles, in [0, 1]. Cosine rather than a raw shared-trigram count so
 * length cannot buy similarity: a 3,000-character abstract shares more trigrams with
 * everything than a 200-character one does, and counts would rank the longest submissions as
 * the most duplicated. Divided by `sqrt(normSquared * normSquared)` rather than by a stored
 * magnitude, because `sqrt(x) * sqrt(x)` is not exactly `x` in floating point and identical
 * abstracts would score 0.9999999999999999. The counts are small integers, so the squares and
 * their product are exact and the identical case lands on exactly 1. The merge walks two
 * iterators rather than indexing, which is the same two-pointer scan without the computed
 * member access the security lint reads as an injection sink.
 */
export function profileSimilarity(a: TextProfile, b: TextProfile): number {
  if (a.normSquared === 0 || b.normSquared === 0) return 0

  const left = a.entries[Symbol.iterator]()
  const right = b.entries[Symbol.iterator]()
  let stepA = left.next()
  let stepB = right.next()
  let dot = 0
  while (stepA.done !== true && stepB.done !== true) {
    if (stepA.value.gram === stepB.value.gram) {
      dot += stepA.value.count * stepB.value.count
      stepA = left.next()
      stepB = right.next()
    } else if (stepA.value.gram < stepB.value.gram) {
      stepA = left.next()
    } else {
      stepB = right.next()
    }
  }

  return Math.min(1, dot / Math.sqrt(a.normSquared * b.normSquared))
}

/** Similarity of two raw texts, in [0, 1]. Symmetric, and never NaN. */
export function similarity(a: string, b: string): number {
  return profileSimilarity(textProfile(a), textProfile(b))
}

/** The one rounding, so the panel and any export quote the same number. */
export function similarityPercent(score: number): number {
  return Math.round(score * 100)
}

/**
 * Build a comparable row from a submission the caller already loaded. `fieldIdByForm` comes
 * from `descriptionFieldIds` in `abstract-text.ts`: the body is a form ANSWER keyed by the id
 * of the field carrying the `description` registry key, so it cannot be read off the record
 * without the forms, and reusing that resolver rather than guessing a key is the difference
 * between comparing abstracts and comparing titles against an empty string.
 */
export function similarityRow(
  submission: SubmissionWithParticipants,
  fieldIdByForm: ReadonlyMap<string, string>,
): SimilarityRow {
  return {
    id: submission.id,
    code: submission.code,
    title: submission.title,
    text: submissionDescription(submission, fieldIdByForm),
  }
}

/**
 * Apply the cap. The FIRST `maxRows` rows are compared and the rest are named, so the caller
 * orders the input by what matters (newest first, or this round only). Zero or less compares
 * nothing rather than reading as "no cap": an explicit zero says do not do this work.
 */
function applyCap(
  rows: readonly SimilarityRow[],
  maxRows: number,
): { kept: readonly SimilarityRow[]; coverage: SimilarityCoverage } {
  const limit = Math.max(0, Math.floor(maxRows))
  const kept = rows.slice(0, limit)
  const dropped = rows.slice(limit)
  return {
    kept,
    coverage: {
      compared: kept.length,
      dropped: dropped.length,
      droppedCodes: dropped.map((row) => row.code),
    },
  }
}

/**
 * Descending by score, then by code: ties are common (two abstracts off one template score
 * identically against a third), and leaving them to sort stability moves rows between renders.
 */
function byScoreThenCode(
  left: { score: number; code: string },
  right: { score: number; code: string },
): number {
  if (right.score !== left.score) return right.score - left.score
  return left.code.localeCompare(right.code)
}

/**
 * Every pair at or above the threshold, O(n^2) over the capped rows. Profiles are built once
 * per row and reused across the whole sweep, which is the difference between n^2 comparisons
 * and n^2 tokenisations. A pair is emitted once, as (earlier, later) in input order, because
 * "SESS-9 is similar to SESS-142" and its mirror are one finding.
 */
export function similarPairs(
  rows: readonly SimilarityRow[],
  options: SimilarityOptions = {},
): SimilarPairsResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const { kept, coverage } = applyCap(rows, options.maxRows ?? DEFAULT_MAX_ROWS)
  const items = kept.map((row) => ({ row, profile: textProfile(rowText(row)) }))

  const found: (SimilarPair & { code: string })[] = []
  for (const [index, item] of items.entries()) {
    for (const other of items.slice(index + 1)) {
      const score = profileSimilarity(item.profile, other.profile)
      if (score < threshold) continue
      const code = `${item.row.code} ${other.row.code}`
      found.push({ a: item.row, b: other.row, score, code })
    }
  }

  found.sort(byScoreThenCode)
  return { ...coverage, pairs: found.map(({ a, b, score }) => ({ a, b, score })) }
}

/**
 * The neighbours of ONE submission, which is what `SimilarPanel` renders. Linear, not
 * quadratic, so the cap here is about what the page can honestly claim to have checked rather
 * than about CPU. The target is matched out by `id`, not by score: a submission is trivially
 * 100% similar to itself, and a self-match at the top of the panel is the kind of thing that
 * makes a reviewer stop reading the rest.
 */
export function similarTo(
  target: SimilarityRow,
  rows: readonly SimilarityRow[],
  options: SimilarityOptions = {},
): SimilarToResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const others = rows.filter((row) => row.id !== target.id)
  const { kept, coverage } = applyCap(others, options.maxRows ?? DEFAULT_MAX_ROWS)
  const targetProfile = textProfile(rowText(target))

  const found: (SimilarNeighbour & { code: string })[] = []
  for (const row of kept) {
    const score = profileSimilarity(targetProfile, textProfile(rowText(row)))
    if (score < threshold) continue
    found.push({ row, score, code: row.code })
  }

  found.sort(byScoreThenCode)
  return { ...coverage, neighbours: found.map(({ row, score }) => ({ row, score })) }
}
