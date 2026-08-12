// Is this form definition well-formed? Returned as problems, never thrown.
//
// `checkDraft` at the bottom is the entry point and the whole surface: it walks the draft in
// wizard order and calls everything else, including the checks that live in sibling modules
// for the line limit (`checks-limits.ts` for role counts and combined character limits,
// `checks-registry.ts` for the typed-column keys, `checkHeadings` in `headings.ts` for the
// authored copy and its two caps).
//
// Three things are checked here, and each one is a class of bug that is silent at author
// time and expensive at submit time:
//
//   - A field definition. A dropdown with no options renders as a control the speaker
//     cannot answer, so a REQUIRED one makes the form impossible to submit.
//   - A conditional rule. `visibleFields` is deliberately forgiving (a dangling
//     controller shows the field, a cycle shows the field) because dropping a required
//     question is unrecoverable at submit time. That forgiveness is the reason the
//     builder has to be strict: the wizard will not tell the organizer their rule is
//     broken, it will quietly ignore it.
//   - A routing rule. A rule pointing at an option that no longer exists files nothing,
//     and a form with rules but no default track files a non-matching submission under
//     no track at all, which is an empty review queue nobody is watching.
//
// The Save action refuses on `severity: 'error'` and stores on a warning, so an
// organizer can leave a form half-built as a draft without being blocked.

import { checkCrossFieldLimits, checkRoleLimits } from '@/features/forms/builder/checks-limits'
import { checkRegistryKeys, type LinkOptions } from '@/features/forms/builder/checks-registry'
import type { FormDraft } from '@/features/forms/builder/draft'
import { OPTION_TYPES } from '@/features/forms/builder/draft'
import { availableControllers } from '@/features/forms/builder/field-ops'
import { checkHeadings } from '@/features/forms/builder/headings'
import { usesEventCategories } from '@/features/forms/builder/option-sources'
import type { BuilderProblem } from '@/features/forms/builder/problem'
import type { FieldCondition, FormField, RoutingConfig } from '@/types/forms'

export { checkCrossFieldLimits } from '@/features/forms/builder/checks-limits'
export type { BuilderProblem } from '@/features/forms/builder/problem'

const OPS_NEEDING_VALUE: readonly FieldCondition['op'][] = ['eq', 'neq', 'in']

/**
 * One question. `all` is the array it sits in, in order, so position matters.
 *
 * `externalOptions` says the option list comes from the EVENT rather than from the form: a
 * Track or Tags question on a CFP form, whose options are this event's own category records.
 * It suppresses the empty-list error below and nothing else, because
 * `checks-registry.checkCategoryOptions` reports that case itself, in words that name where
 * the categories come from. Refusing the save here instead made a new form on an event with
 * no categories impossible to save at all (the CFP-01 evaluation finding).
 */
export function checkFieldDefinition(
  field: FormField,
  all: readonly FormField[],
  step: number,
  externalOptions = false,
): readonly BuilderProblem[] {
  const problems: BuilderProblem[] = []
  const at = (message: string, severity: BuilderProblem['severity'] = 'error') => {
    problems.push({ severity, step, message, fieldId: field.id })
  }
  const name = field.label.trim().length === 0 ? 'This question' : field.label.trim()

  if (field.label.trim().length === 0) at('Every question needs a label.')
  if (OPTION_TYPES.includes(field.type)) {
    const options = field.options ?? []
    if (options.length === 0 && !externalOptions)
      at(`${name} is a choice question with no options.`)
    if (new Set(options.map((option) => option.value)).size !== options.length) {
      at(`${name} has two options with the same value.`)
    }
  }
  if (field.maxLen !== undefined && field.maxLen <= 0) {
    at(`${name} has a character limit of zero, which nothing can satisfy.`)
  }
  if (field.showIf !== undefined) {
    problems.push(...checkCondition(field.showIf, field, all, step))
  }
  return problems
}

/**
 * One `showIf` rule, against the field it belongs to and the array it sits in.
 *
 * The position check is the one that catches the mistake an organizer actually makes:
 * adding a conditional question and then dragging its controller below it. The rule
 * still parses, `visibleFields` still evaluates it, and the speaker is asked a question
 * that depends on an answer they have not been given the chance to write yet.
 */
export function checkCondition(
  condition: FieldCondition,
  field: FormField,
  all: readonly FormField[],
  step: number,
): readonly BuilderProblem[] {
  const problems: BuilderProblem[] = []
  const at = (message: string) => {
    problems.push({ severity: 'error', step, message, fieldId: field.id })
  }
  const name = field.label.trim().length === 0 ? 'A question' : field.label.trim()
  const controller = all.find((candidate) => candidate.id === condition.fieldId)

  if (condition.fieldId === field.id) {
    at(`${name} has a condition on its own answer.`)
    return problems
  }
  if (controller === undefined) {
    at(`${name} depends on a question that is no longer on this form.`)
    return problems
  }
  if (!availableControllers(all, field.id).some((candidate) => candidate.id === controller.id)) {
    at(
      `${name} depends on "${controller.label}", which is not asked before it or is itself conditional.`,
    )
  }
  if (OPS_NEEDING_VALUE.includes(condition.op) && conditionValues(condition).length === 0) {
    at(`${name} has a condition with no value to compare against.`)
  }
  const options = controller.options ?? []
  if (options.length > 0) {
    const unknown = conditionValues(condition).filter(
      (value) => !options.some((option) => option.value === value),
    )
    if (unknown.length > 0) {
      at(
        `${name} depends on an option "${unknown.join(', ')}" that "${controller.label}" no longer offers.`,
      )
    }
  }
  return problems
}

/** Track routing, against the questions it fires on and the event's own tracks. */
export function checkRouting(
  routing: RoutingConfig,
  fields: readonly FormField[],
  trackIds: readonly string[],
  step: number,
): readonly BuilderProblem[] {
  const problems: BuilderProblem[] = []
  const at = (message: string, severity: BuilderProblem['severity'] = 'error') => {
    problems.push({ severity, step, message })
  }

  for (const rule of routing.rules) {
    const controller = fields.find((field) => field.id === rule.when.fieldId)
    if (controller === undefined) {
      at('A routing rule fires on a question that is no longer on this form.')
      continue
    }
    if (OPS_NEEDING_VALUE.includes(rule.when.op) && conditionValues(rule.when).length === 0) {
      at(`A routing rule on "${controller.label}" has no value to match.`)
    }
    const options = controller.options ?? []
    const unknown = conditionValues(rule.when).filter(
      (value) => !options.some((option) => option.value === value),
    )
    if (options.length > 0 && unknown.length > 0) {
      at(
        `A routing rule matches "${unknown.join(', ')}", which "${controller.label}" no longer offers.`,
      )
    }
    if (!trackIds.includes(rule.trackId)) {
      at('A routing rule points at a category that no longer exists on this event.')
    }
  }
  if (
    routing.defaultTrackId !== undefined &&
    routing.defaultTrackId.length > 0 &&
    !trackIds.includes(routing.defaultTrackId)
  ) {
    at('The fallback category no longer exists on this event.')
  }
  if (routing.rules.length > 0 && (routing.defaultTrackId ?? '').length === 0) {
    // A warning rather than an error: routing falls back to the Track question's own
    // answer when no rule matches, so this is a hole rather than a certainty.
    at(
      'No fallback category is set, so a submission that matches no rule may land untracked.',
      'warning',
    )
  }
  return problems
}

/** The whole draft, in the order the wizard walks it. */
export function checkDraft(
  draft: FormDraft,
  trackIds: readonly string[],
  tagIds?: readonly string[],
  /**
   * Whether this form's answers reach the typed LINK columns, which only a CFP form's do.
   *
   * A portal form stores everything in `TaskAssignments.answersJson`: `splitAnswers` is never
   * called on it, so a `track` or `tags` option value is inert text rather than a record id
   * that ends up in a link. Running the link check anyway rejected every legitimate Track or
   * Tags question on a portal form as "not belonging to this event", because the caller has no
   * event track list to pass and would gain nothing by having one. Found by Codex review, and
   * it was a regression the cross-event Track fix introduced here through the shared check.
   */
  writesLinkColumns = true,
): readonly BuilderProblem[] {
  const problems: BuilderProblem[] = []
  if (draft.name.trim().length === 0) {
    problems.push({ severity: 'error', step: 2, message: 'Internal Form Name is required.' })
  }
  // A Track or Tags question only counts as event-sourced on a form that WRITES the link
  // columns. On a portal form the same option list is inert text the organizer authored, so
  // an empty one is their own omission and stays an error.
  const fromEvent = (field: FormField): boolean => writesLinkColumns && usesEventCategories(field)
  for (const field of draft.fields) {
    problems.push(...checkFieldDefinition(field, draft.fields, 3, fromEvent(field)))
  }
  if (draft.participantsEnabled) {
    for (const field of draft.participantFields) {
      problems.push(...checkFieldDefinition(field, draft.participantFields, 4, fromEvent(field)))
    }
    const enabled = draft.roles.filter((rule) => rule.enabled)
    if (enabled.length === 0) {
      problems.push({
        severity: 'error',
        step: 4,
        message: 'Enable at least one participant role, or turn the Participants step off.',
      })
    }
    if (enabled.every((rule) => rule.min === 0)) {
      problems.push({
        severity: 'warning',
        step: 4,
        message: 'No role has a minimum, so a submission can arrive with nobody on it.',
      })
    }
    problems.push(...checkRoleLimits(enabled, 4))
  }
  problems.push(...checkRouting(draft.routing, draft.fields, trackIds, 3))
  const links: LinkOptions | undefined = writesLinkColumns ? { trackIds, tagIds } : undefined
  problems.push(...checkRegistryKeys(draft.fields, links, 3))
  if (draft.participantsEnabled) {
    problems.push(...checkRegistryKeys(draft.participantFields, links, 4))
  }
  problems.push(
    ...checkHeadings({
      headings: draft,
      participantsEnabled: draft.participantsEnabled,
      // Only a CFP form has the six heading controls. `entityType` is what tells the two
      // apart: it is set on a portal form and absent on a call for papers.
      authored: draft.entityType === undefined,
    }),
  )
  // Authored on step 6, so that is where a broken rule sends the organizer.
  problems.push(
    ...checkCrossFieldLimits(draft.crossFieldLimits, draft.fields, draft.participantFields, 6),
  )
  return problems
}

export function hasBlockingProblem(problems: readonly BuilderProblem[]): boolean {
  return problems.some((problem) => problem.severity === 'error')
}

/**
 * The problems that refuse a PUBLISH: every error, plus the warnings whose whole content is
 * that an answer would be lost.
 *
 * Two gates rather than one, because a draft and a published form are not the same promise.
 * Save is deliberately permissive (see `blocksPublish` in problem.ts for the finding that
 * made it so), and publish is where the form stops being the organizer's working copy and
 * starts being the thing a stranger types into.
 */
export function publishBlockers(problems: readonly BuilderProblem[]): readonly BuilderProblem[] {
  return problems.filter(
    (problem) => problem.severity === 'error' || problem.blocksPublish === true,
  )
}

function conditionValues(condition: FieldCondition): readonly string[] {
  if (condition.value === undefined) return []
  const values = typeof condition.value === 'string' ? [condition.value] : condition.value
  return values.filter((value) => value.trim().length > 0)
}
