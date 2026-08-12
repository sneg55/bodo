// The keyless ask: what `AI_MOCK=1` answers with.
//
// Split out of `ask.ts` because it is a different concern (what a clone with an empty
// `.env` demonstrates) and because that file is at its size limit.
//
// **It is a keyword scan and it says so in its own first sentence.** The alternative, a
// frozen paragraph that reads like an answer, would demo better and would stop tracking
// the data the moment the event changed. This one counts real rows against the real total
// and names the ones it found, which is a thing this code can honestly do.
// `AI_SAMPLE_NOTICE` renders above it as well, so nothing here is mistaken for a model.
//
// **Deterministic, because the mock is what the tests exercise.** Nothing reads a clock or
// a random source, every list keeps the order it arrived in, and the scanned terms are
// deduplicated in first-seen order, so two presses of the same question produce the same
// sentence and the same refs.
//
// **It cites only ids from the rows it was given**, which are the rows the snapshot
// carried, so `resolveRefs` resolves every one of them. The mock is held to the rule the
// model is held to rather than being exempt from it.

import type { AskAnswer, AskRows } from '@/features/ai/ask'
import { speakerName } from '@/features/ai/ask'
import { GROUP_LIMIT } from '@/features/search/global-search'

/**
 * Shorter than this and a word matches most of an event: `of`, `is`, `to`. The scan is
 * crude on purpose, and a crude scan that matches everything looks like a broken one.
 */
const MOCK_TERM_MIN = 3

/** Per kind, so a question about sessions still surfaces a speaker or two under it. */
const MOCK_REFS_PER_KIND = GROUP_LIMIT / 2

/** How many matches the sample sentence names before it stops listing. */
const MOCK_NAMED = 3

function terms(question: string): readonly string[] {
  const words = question.toLowerCase().split(/[^a-z0-9-]+/)
  return [...new Set(words.filter((word) => word.length >= MOCK_TERM_MIN))]
}

function hits(haystack: string, needles: readonly string[]): boolean {
  const text = haystack.toLowerCase()
  return needles.some((needle) => text.includes(needle))
}

/** The canned answer, computed from the rows the live call would have been given. */
export function mockAskAnswer(input: { question: string } & AskRows): AskAnswer {
  const scanned = terms(input.question)
  // Names the flag rather than guessing at the deployment: `AI_MOCK=1` is what selects this
  // path, and a key may well be set alongside it. Same correction as `AI_SAMPLE_NOTICE`.
  const lead = 'AI_MOCK=1, so this is a keyword scan of the event rather than a model answer.'

  if (scanned.length === 0) {
    return {
      answer: `${lead} The question held no word of ${MOCK_TERM_MIN} characters or more, so there was nothing to scan for.`,
      refs: [],
    }
  }

  const submissions = input.submissions.filter((row) =>
    hits([row.code, row.title].join(' '), scanned),
  )
  const speakers = input.speakers.filter((row) =>
    hits([speakerName(row), row.email, row.company ?? ''].join(' '), scanned),
  )

  const named = [
    ...submissions.slice(0, MOCK_NAMED).map((row) => row.code),
    ...speakers.slice(0, MOCK_NAMED).map(speakerName),
  ]

  const counts = `${submissions.length} of ${input.submissions.length} submissions and ${speakers.length} of ${input.speakers.length} speakers mention ${scanned.map((term) => `"${term}"`).join(', ')}.`

  return {
    answer: `${lead} ${counts} ${named.length === 0 ? 'None of them are listed below because none matched.' : `Matched: ${named.join(', ')}.`}`,
    refs: [
      ...submissions
        .slice(0, MOCK_REFS_PER_KIND)
        .map((row) => ({ kind: 'submission' as const, id: row.id })),
      ...speakers
        .slice(0, MOCK_REFS_PER_KIND)
        .map((row) => ({ kind: 'speaker' as const, id: row.id })),
    ],
  }
}
