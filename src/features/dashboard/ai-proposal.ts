// The `AI prompt` tab's proposal: what is asked for, what comes back, and what is allowed
// through.
//
// Pure, so the two vocabularies this surface is closed over can be enforced without a network
// and without Airtable. That matters more here than on most surfaces, because a proposal is
// untrusted TWICE: once as model output, and again when the browser posts the previewed
// proposal back to the create action. `validateProposal` is the one gate both go through, which
// is why it takes `unknown` rather than the type it returns.
//
// **Unknown entries are dropped, never fatal.** `metric` and `color` are Airtable single-selects
// (src/migrations/tables-cms.ts), so a value outside the enum is a write the base rejects, and a
// rejected widget write inside `createDashboard` rolls its own tab back: an organizer would
// watch a dashboard appear and then vanish. This is the same discipline `addWidgetAction`
// applies to a metric arriving from the browser, extended to a list, because a model asked for
// five widgets and naming one this build cannot draw has still answered for the other four.
// Refusing the lot would throw those away.
//
// **An empty surviving list IS fatal**, and that is the one asymmetry. A dashboard with no
// widgets is a tab that opens onto nothing, and the organizer described something specific; the
// honest answer is that none of it can be drawn, not a blank grid they have to fill by hand.
//
// **The prompt does not carry the event snapshot.** Choosing among eight fixed aggregates needs
// the catalogue and the organizer's sentence, and nothing else: sending submission titles and
// speaker emails to the model would buy nothing and would put event data in a prompt that has
// no use for it. This is the one AI surface here that is not grounded in the event's rows, on
// purpose.

import { WIDGET_CATALOG, widgetSpec } from '@/features/dashboard/widget-catalog'
import {
  DASHBOARD_COLORS,
  type DashboardColor,
  WIDGET_METRICS,
  type WidgetMetric,
} from '@/services/airtable/mapping-dashboards'
import type { WidgetDraft } from '@/services/airtable/to-fields-dashboards'

/** The same caps `actions.ts` cuts the Settings dialog to, so both writers agree. */
export const PROPOSAL_NAME_LIMIT = 120
export const PROPOSAL_DESCRIPTION_LIMIT = 500

/**
 * How many widgets a proposal may carry.
 *
 * Six rather than the eight the catalogue holds: the two captured dashboards render four widgets
 * each (refs 38 and 39) and the widest gallery template creates five, so six is already one past
 * anything the reference shows. A proposal naming all eight is a model padding the answer out
 * rather than choosing, and the organizer can add the rest from `+ Add Widget`.
 */
export const PROPOSAL_METRIC_LIMIT = 6

/**
 * Thinking AND the answer share this budget (see services/ai/client.ts), so it is sized for
 * both. The answer itself is four short fields; the headroom is the thinking.
 */
export const PROPOSAL_MAX_TOKENS = 2000

export type DashboardProposal = {
  name: string
  color: DashboardColor
  /** The line under `CUSTOM DASHBOARD`, refs 38 and 39. Empty renders no line. */
  description: string
  metrics: readonly WidgetMetric[]
}

export type ProposalCheck =
  | { ok: true; proposal: DashboardProposal }
  | { ok: false; message: string }

/**
 * `output_config.format`'s schema.
 *
 * The enums are stated here as well as re-checked in `validateProposal`, and neither is
 * redundant: the schema is what makes a well-behaved model answer in the vocabulary in the first
 * place, and the validation is what holds when it does not, or when the object comes back from
 * the browser at create time having never been near the model.
 */
export const PROPOSAL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The tab label. A few words, title case.' },
    color: { type: 'string', enum: [...DASHBOARD_COLORS] },
    description: {
      type: 'string',
      description: 'One sentence, shown under the dashboard title.',
    },
    // No `minItems` or `maxItems`: structured output refuses `maxItems` on an array with a
    // 400, which took down every dashboard proposal as soon as AI_MOCK went to 0, and
    // `minItems` is dropped alongside it rather than left as the one array constraint whose
    // support nobody has verified. Neither was load-bearing. `readProposal` dedupes and
    // slices to PROPOSAL_METRIC_LIMIT, and refuses a proposal with no valid metric at all,
    // so both bounds are enforced where the value is actually used.
    metrics: {
      type: 'array',
      items: { type: 'string', enum: [...WIDGET_METRICS] },
    },
  },
  required: ['name', 'color', 'description', 'metrics'],
  additionalProperties: false,
}

export const PROPOSAL_SYSTEM = [
  'You lay out dashboards for a conference speaker-and-session platform.',
  'An organizer describes what they want to see. You choose widgets for them.',
  '',
  'Rules:',
  '- Choose only from the metrics listed in the catalogue you are given. There are no others,',
  '  and inventing one produces a widget that cannot be drawn.',
  '- Choose the fewest widgets that answer the description. Do not pad the list out.',
  '- If the description asks for something the catalogue cannot express, cover the part it can',
  '  and leave the rest out rather than substituting a metric that is merely nearby.',
  '- The name is a tab label: a few words, no punctuation at the end.',
  '- The description is one sentence saying what the dashboard shows.',
].join('\n')

/**
 * The catalogue, as the prompt's cacheable half.
 *
 * Built from `WIDGET_CATALOG` rather than written out, so a metric added to the enum reaches the
 * model without anyone remembering to edit a prompt. It carries the same `summary` line the Add
 * Widget gallery shows an organizer, which is the description of the metric that has already
 * been written for a human reader.
 */
export const PROPOSAL_CONTEXT = [
  '# Metrics',
  ...WIDGET_CATALOG.map((spec) => `${spec.metric}  ${spec.title}  ${spec.summary}`),
  '',
  '# Colors',
  DASHBOARD_COLORS.join(', '),
].join('\n')

/** The volatile half, which sits after the cache breakpoint. */
export function proposalQuestion(description: string): string {
  return `The organizer wants a dashboard that shows:\n${description}`
}

/**
 * Every value that arrives from outside, checked once.
 *
 * Takes `unknown` deliberately. Typing the parameter as `DashboardProposal` would make the two
 * call sites that most need this (a model's JSON, and a client component's POST body) look
 * already-safe at the point where they are not.
 */
export function validateProposal(raw: unknown): ProposalCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'The model did not answer with a dashboard.' }
  }
  const source = raw as Record<string, unknown>

  const name = cut(readText(source.name).trim(), PROPOSAL_NAME_LIMIT)
  // The one field with no honest default: an unnamed tab is an unlabelled tab in the strip, and
  // naming it here would be this file authoring product rather than validating it.
  if (name === '') return { ok: false, message: 'The proposed dashboard has no name.' }

  const list = asArray(source.metrics)
  if (list === undefined) return { ok: false, message: 'The proposal named no widgets.' }

  // Filter, then dedupe, then cap, in that order. Deduping first would let two spellings of an
  // unknown metric eat two of the six slots, and capping first would spend the budget on
  // entries that are about to be dropped anyway.
  const metrics = [...new Set(list.filter(isMetric))].slice(0, PROPOSAL_METRIC_LIMIT)
  if (metrics.length === 0) {
    return { ok: false, message: 'None of the proposed widgets exist in this build.' }
  }

  return {
    ok: true,
    proposal: {
      name,
      // The same fallback `mapDashboard` gives a colourless row: a dot the organizer can change
      // in Settings beats a hole in the tab strip, and the colour is decoration either way.
      color: DASHBOARD_COLORS.find((option) => option === source.color) ?? 'blue',
      description: cut(readText(source.description).trim(), PROPOSAL_DESCRIPTION_LIMIT),
      metrics,
    },
  }
}

/**
 * The widget rows a proposal creates, in the order it proposed them.
 *
 * Titles and shapes come from `widget-catalog.ts` and never from the proposal, for the reason
 * `addWidgetAction` gives: a caller that could name the widget could also name a shape the
 * metric cannot draw. This is `templateWidgets` over a metric list rather than over a gallery
 * card, and the eight transcribed titles stay in one place.
 */
export function proposalWidgets(
  metrics: readonly WidgetMetric[],
): readonly Omit<WidgetDraft, 'dashboardId'>[] {
  return metrics.map((metric, index) => {
    const spec = widgetSpec(metric)
    return { title: spec.title, widgetType: spec.widgetType, metric, order: index }
  })
}

function isMetric(value: unknown): value is WidgetMetric {
  return typeof value === 'string' && WIDGET_METRICS.some((option) => option === value)
}

/** A missing or non-string field reads as empty, which the caller then judges. */
function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** `Array.isArray` widens `unknown` to `any[]`, which every later call then inherits. */
function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? (value as readonly unknown[]) : undefined
}

/**
 * A label longer than the column should hold is cut, not refused. Same rule as actions.ts.
 *
 * Exported for `ai-proposal-mock.ts`, which has to hit the same caps this file enforces: a mock
 * whose own output failed validation would be a fixture that cannot be created.
 */
export function cut(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit)
}
