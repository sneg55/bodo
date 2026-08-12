// The StepWizard primitive's navigation rules.
//
// Tested directly rather than through either wizard, because the two callers disagree on
// exactly one thing (a create flow gates, an editor does not) and the interesting cases are
// the ones neither caller reaches on a happy path: an id that is not in the list, a step
// behind the current one that has become invalid, and the boundary at each end.

import { describe, expect, it } from 'vitest'

import {
  canAdvance,
  canReachStep,
  isFinalStep,
  lockedSteps,
  neighbourStep,
  stepPosition,
  visitedSteps,
  type WizardGate,
  type WizardStep,
} from '@/components/primitives/step-wizard'

const STEPS: readonly WizardStep[] = [
  { id: 'setup', title: 'Name and type' },
  { id: 'filters', title: 'Filters' },
  { id: 'review', title: 'Review' },
  { id: 'content', title: 'Content' },
]

const free: WizardGate = { mode: 'free', completed: new Set() }
const gate = (...done: string[]): WizardGate => ({ mode: 'gated', completed: new Set(done) })

describe('stepPosition', () => {
  it('answers -1 for a step that is not in the list', () => {
    expect(stepPosition(STEPS, 'payments')).toBe(-1)
  })
})

describe('neighbourStep', () => {
  it('clamps at both ends rather than wrapping', () => {
    expect(neighbourStep(STEPS, 'setup', -1)).toBe('setup')
    expect(neighbourStep(STEPS, 'content', 1)).toBe('content')
  })

  it('returns the unknown step unchanged rather than jumping to the first', () => {
    expect(neighbourStep(STEPS, 'payments', 1)).toBe('payments')
  })

  it('moves one step in each direction', () => {
    expect(neighbourStep(STEPS, 'filters', 1)).toBe('review')
    expect(neighbourStep(STEPS, 'filters', -1)).toBe('setup')
  })
})

describe('canReachStep', () => {
  it('lets an editor jump anywhere, which is why the form builder passes free mode', () => {
    expect(canReachStep(STEPS, 'setup', 'content', free)).toBe(true)
  })

  it('always allows going backwards, even with nothing completed', () => {
    expect(canReachStep(STEPS, 'review', 'setup', gate())).toBe(true)
  })

  it('stops at the first INCOMPLETE step, not at the last complete one', () => {
    // Step 2 is complete and step 1 has since been emptied. The looser rule ("every step
    // before target is complete" read as a count) would let this reach `review` on the
    // strength of a filters step describing a portal that no longer has a name.
    const partial = gate('filters')
    expect(canReachStep(STEPS, 'filters', 'review', partial)).toBe(false)
    expect(canReachStep(STEPS, 'setup', 'filters', gate('setup'))).toBe(true)
  })

  it('refuses a target that is not a step', () => {
    expect(canReachStep(STEPS, 'setup', 'payments', free)).toBe(false)
  })
})

describe('visitedSteps', () => {
  it('is position-based, so a step that has been emptied still reads as visited', () => {
    expect(visitedSteps(STEPS, 'review')).toEqual(['setup', 'filters'])
  })

  it('is empty on the first step and on an unknown one', () => {
    expect(visitedSteps(STEPS, 'setup')).toEqual([])
    expect(visitedSteps(STEPS, 'payments')).toEqual([])
  })
})

describe('lockedSteps', () => {
  it('locks nothing in free mode, by construction', () => {
    expect(lockedSteps(STEPS, 'setup', free)).toEqual([])
  })

  it('locks everything past the first incomplete step', () => {
    expect(lockedSteps(STEPS, 'setup', gate('setup'))).toEqual(['review', 'content'])
  })
})

describe('canAdvance', () => {
  it('is false on the last step, where the wizard shows its own action instead', () => {
    expect(canAdvance(STEPS, 'content', free)).toBe(false)
  })

  it('needs the current step complete when gated, and nothing when free', () => {
    expect(canAdvance(STEPS, 'filters', gate('setup'))).toBe(false)
    expect(canAdvance(STEPS, 'filters', gate('setup', 'filters'))).toBe(true)
    expect(canAdvance(STEPS, 'filters', free)).toBe(true)
  })

  it('refuses when an EARLIER step has been edited back into an invalid state', () => {
    // Regression, found by review. `canAdvance` used to test only the current step, so a
    // valid step 2 standing on a broken step 1 left Continue live while the rail was
    // already greying step 3. The button walked past a gate the rail was drawing shut.
    expect(canAdvance(STEPS, 'filters', gate('filters'))).toBe(false)
    expect(lockedSteps(STEPS, 'filters', gate('filters'))).toContain('review')
  })
})

describe('isFinalStep', () => {
  it('is true only for the last step, and false for an empty wizard', () => {
    expect(isFinalStep(STEPS, 'content')).toBe(true)
    expect(isFinalStep(STEPS, 'review')).toBe(false)
    expect(isFinalStep([], 'content')).toBe(false)
  })
})
