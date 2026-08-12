// Whether a field definition, a conditional rule and a routing rule are well-formed.
//
// These exist because `visibleFields` and `matchedTrackId` are deliberately forgiving: a
// dangling controller shows the field, a cycle shows the field, an unmatched rule falls
// through to the default. That is correct at render time, since dropping a required
// question is unrecoverable, and it is exactly why the builder has to be strict. The
// wizard will never tell an organizer their rule is broken, it will quietly ignore it.
//
// The column-protection suites live in `builder-column-checks.test.ts`, and the shared
// fixture in `helpers/builder-checks-fixtures.ts`, since this file passed the size limit.

import { describe, expect, it } from 'vitest'

import {
  checkCondition,
  checkDraft,
  checkFieldDefinition,
  checkRouting,
  hasBlockingProblem,
} from '@/features/forms/builder/checks'
import type { FormField } from '@/types/forms'

import { draft, FORMAT, LAB, messages, TRACKS } from './helpers/builder-checks-fixtures'

describe('checkFieldDefinition', () => {
  it('accepts a well-formed dropdown with a condition on an earlier question', () => {
    expect(checkFieldDefinition(LAB, [FORMAT, LAB], 3)).toEqual([])
  })

  it('rejects a question with no label', () => {
    const problems = checkFieldDefinition({ ...FORMAT, label: '  ' }, [FORMAT], 3)

    expect(messages(problems)).toContain('needs a label')
  })

  it('rejects a choice question with no options, which nobody can answer', () => {
    const problems = checkFieldDefinition({ ...FORMAT, options: [] }, [FORMAT], 3)

    expect(messages(problems)).toContain('no options')
  })

  it('rejects two options that store the same value', () => {
    const dupe: FormField = {
      ...FORMAT,
      options: [
        { value: 'talk', label: 'Talk' },
        { value: 'talk', label: 'Talk again' },
      ],
    }

    expect(messages(checkFieldDefinition(dupe, [dupe], 3))).toContain('same value')
  })

  it('rejects a character limit of zero', () => {
    const problems = checkFieldDefinition({ ...LAB, maxLen: 0, showIf: undefined }, [], 3)

    expect(messages(problems)).toContain('character limit of zero')
  })
})

describe('checkCondition', () => {
  it('rejects a condition on the field itself', () => {
    const selfRef: FormField = { ...LAB, showIf: { fieldId: 'b', op: 'answered' } }
    const problems = checkCondition(selfRef.showIf!, selfRef, [FORMAT, selfRef], 3)

    expect(messages(problems)).toContain('its own answer')
  })

  it('rejects a controller that is not on the form', () => {
    const problems = checkCondition({ fieldId: 'gone', op: 'answered' }, LAB, [LAB], 3)

    expect(messages(problems)).toContain('no longer on this form')
  })

  it('rejects a controller that is asked after the dependent question', () => {
    // The mistake an organizer actually makes: add the conditional question, then drag
    // its controller below it. The rule still parses and the speaker is asked something
    // that depends on an answer they have not been offered yet.
    const problems = checkCondition(LAB.showIf!, LAB, [LAB, FORMAT], 3)

    expect(messages(problems)).toContain('not asked before it')
  })

  it('rejects a chain, because the contract is one dependency level', () => {
    const second: FormField = { id: 'c', type: 'text', label: 'Bench', required: false }
    const condition = { fieldId: 'b', op: 'answered' } as const
    const problems = checkCondition(condition, second, [FORMAT, LAB, second], 3)

    expect(messages(problems)).toContain('is itself conditional')
  })

  it('rejects eq with no value to compare against', () => {
    const problems = checkCondition({ fieldId: 'a', op: 'eq' }, LAB, [FORMAT, LAB], 3)

    expect(messages(problems)).toContain('no value to compare')
  })

  it('accepts answered with no value, which is the one op that needs none', () => {
    expect(checkCondition({ fieldId: 'a', op: 'answered' }, LAB, [FORMAT, LAB], 3)).toEqual([])
  })

  it('rejects a value the controlling dropdown no longer offers', () => {
    const condition = { fieldId: 'a', op: 'eq', value: 'keynote' } as const
    const problems = checkCondition(condition, LAB, [FORMAT, LAB], 3)

    expect(messages(problems)).toContain('no longer offers')
  })
})

describe('checkRouting', () => {
  it('accepts rules on a real option with a real track and a fallback', () => {
    const problems = checkRouting(
      {
        rules: [{ when: { fieldId: 'a', op: 'eq', value: 'workshop' }, trackId: 'recInfra' }],
        defaultTrackId: 'recProduct',
      },
      [FORMAT],
      TRACKS,
      3,
    )

    expect(problems).toEqual([])
  })

  it('rejects a rule pointing at a category the event does not have', () => {
    const problems = checkRouting(
      {
        rules: [{ when: { fieldId: 'a', op: 'eq', value: 'talk' }, trackId: 'recDeleted' }],
        defaultTrackId: 'recProduct',
      },
      [FORMAT],
      TRACKS,
      3,
    )

    expect(messages(problems)).toContain('no longer exists on this event')
  })

  it('rejects a rule matching an option the question no longer offers', () => {
    const problems = checkRouting(
      {
        rules: [{ when: { fieldId: 'a', op: 'eq', value: 'keynote' }, trackId: 'recInfra' }],
        defaultTrackId: 'recProduct',
      },
      [FORMAT],
      TRACKS,
      3,
    )

    expect(messages(problems)).toContain('no longer offers')
  })

  it('warns rather than blocks when rules exist with no fallback category', () => {
    const problems = checkRouting(
      { rules: [{ when: { fieldId: 'a', op: 'eq', value: 'talk' }, trackId: 'recAgents' }] },
      [FORMAT],
      TRACKS,
      3,
    )

    expect(hasBlockingProblem(problems)).toBe(false)
    expect(messages(problems)).toContain('may land untracked')
  })
})

describe('checkDraft', () => {
  it('passes the R1 acceptance shape: one conditional field and two routed categories', () => {
    expect(checkDraft(draft(), TRACKS)).toEqual([])
  })

  it('blocks a form with no internal name and says which step to fix it on', () => {
    const problems = checkDraft(draft({ name: ' ' }), TRACKS)

    expect(hasBlockingProblem(problems)).toBe(true)
    expect(problems.at(0)?.step).toBe(2)
  })

  it('blocks a participants step with every role disabled', () => {
    const problems = checkDraft(
      draft({ roles: [{ role: 'speaker', enabled: false, min: 1, max: 1 }] }),
      TRACKS,
    )

    expect(messages(problems)).toContain('at least one participant role')
  })

  it('does not check participant questions the form will not collect', () => {
    const broken: FormField = { id: 'p', type: 'select', label: '', required: true, options: [] }
    const problems = checkDraft(
      draft({ participantsEnabled: false, participantFields: [broken] }),
      TRACKS,
    )

    expect(problems).toEqual([])
  })

  it('reports a broken participant question on step 4 when the step is on', () => {
    const broken: FormField = { id: 'p', type: 'select', label: '', required: true, options: [] }
    const problems = checkDraft(draft({ participantFields: [broken] }), TRACKS)

    expect(problems.every((problem) => problem.step === 4)).toBe(true)
    expect(hasBlockingProblem(problems)).toBe(true)
  })
})
