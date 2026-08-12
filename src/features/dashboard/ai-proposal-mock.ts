// The `AI prompt` tab's keyless path: a proposal computed from the description, with no model
// behind it.
//
// Split out of ai-proposal.ts only because the two together exceed this repo's file-size limit.
// The direction of the dependency is the useful part of the split: the mock has to satisfy the
// caps and vocabularies that file defines, and never the other way round.
//
// **Computed, never a frozen object**, for the reason services/ai/mock.ts gives: a fixture that
// answers the same thing to every question demonstrates nothing about the surface it is standing
// in for. It scores each catalogue entry by how many of the organizer's own words appear in that
// entry's title and summary. That is a crude retrieval and is not pretending to be more: the tab
// renders `AI_SAMPLE_NOTICE` above it, and what is being shown is that the tab proposes,
// previews and creates, not that a word count reasons about dashboards.
//
// **Deterministic in all four fields**, including the colour, which is why that one is derived
// from the text rather than picked at random. A sample proposal that changed between two clicks
// on the same sentence would read as a model changing its mind.

import {
  cut,
  type DashboardProposal,
  PROPOSAL_DESCRIPTION_LIMIT,
  PROPOSAL_METRIC_LIMIT,
  PROPOSAL_NAME_LIMIT,
} from '@/features/dashboard/ai-proposal'
import { WIDGET_CATALOG } from '@/features/dashboard/widget-catalog'
import {
  DASHBOARD_COLORS,
  type DashboardColor,
  type WidgetMetric,
} from '@/services/airtable/mapping-dashboards'

/** Letters and digits only, so punctuation cannot make two spellings of one word. */
const WORD = /[\p{Letter}\p{Number}]+/gu

/**
 * The shortest word worth matching on.
 *
 * Four, which drops the connectives ("who", "not", "are", "how") that appear in almost every
 * summary and would otherwise score every metric equally.
 */
const MIN_WORD = 4

/** With nothing matched, the three headline counts rather than an empty list. See below. */
const FALLBACK_METRICS: readonly WidgetMetric[] = [
  'total_submissions',
  'pending_review',
  'accepted_speakers',
]

export function mockProposal(description: string): DashboardProposal {
  const asked = words(description)
  const scored = WIDGET_CATALOG.map((spec, index) => ({
    metric: spec.metric,
    index,
    score: overlap(asked, words(`${spec.title} ${spec.summary}`)),
  })).filter((entry) => entry.score > 0)

  // Ties break on catalogue position, which is the order the two captured dashboards introduce
  // the widgets in, so one description always produces one list in one order.
  scored.sort((left, right) => right.score - left.score || left.index - right.index)
  const matched = scored.slice(0, PROPOSAL_METRIC_LIMIT).map((entry) => entry.metric)

  return {
    name: mockName(description),
    color: mockColor(description),
    // The organizer's own sentence becomes the line under the title. Summarising their sentence
    // is exactly the part a word count cannot do honestly.
    description: cut(description.trim(), PROPOSAL_DESCRIPTION_LIMIT),
    // An empty list is an error in `validateProposal`, so a description matching nothing would
    // make a keyless deployment look broken rather than sampled.
    metrics: matched.length === 0 ? FALLBACK_METRICS : matched,
  }
}

/** Up to five words of the description, title-cased. `New Dashboard` for a wordless one. */
function mockName(description: string): string {
  const first = [...description.matchAll(WORD)].slice(0, 5).map((match) => capitalize(match[0]))
  return first.length === 0 ? 'New Dashboard' : cut(first.join(' '), PROPOSAL_NAME_LIMIT)
}

/**
 * A colour from the text itself, so two sample proposals in a row do not both come out blue.
 *
 * A sum of code points rather than a real hash: the whole requirement is that one sentence lands
 * on one colour, and this is decoration on a value the organizer can change in Settings.
 */
function mockColor(description: string): DashboardColor {
  const total = [...description].reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0)
  // `.at()` rather than a computed subscript, which `security/detect-object-injection` flags.
  // The `??` is a type requirement: the modulus is always in range.
  return DASHBOARD_COLORS.at(total % DASHBOARD_COLORS.length) ?? 'blue'
}

/**
 * The matchable words in a piece of text.
 *
 * A trailing `s` is dropped, so an organizer asking about "speakers" matches a summary that says
 * "speaker". That is the whole of the stemming, and it is enough for eight summaries.
 */
function words(text: string): ReadonlySet<string> {
  const found = [...text.toLowerCase().matchAll(WORD)]
    .map((match) => stem(match[0]))
    .filter((word) => word.length >= MIN_WORD)
  return new Set(found)
}

function stem(word: string): string {
  return word.length > MIN_WORD && word.endsWith('s') ? word.slice(0, -1) : word
}

function overlap(asked: ReadonlySet<string>, offered: ReadonlySet<string>): number {
  return [...asked].filter((word) => offered.has(word)).length
}

function capitalize(word: string): string {
  return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`
}
