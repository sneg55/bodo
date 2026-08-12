// The chair's override of an AI pre-screen score. ABS-14.
//
// Three properties, and the rubric item fails on any one of them:
//
//   1. It PERSISTS. It is a field on the AI's own review row, so it survives a reload, which
//      is the property a client-side "overridden" flag would not have had.
//   2. It stays DISTINGUISHABLE. The machine's own score, rationale and recommendation are
//      carried through untouched, so a reader can see what was overridden and by whom.
//   3. It cannot be mistaken for a criterion. The reserved key lives in the same blob as the
//      reviewer's per-criterion notes, so a shape that could collide with a criterion key
//      would surface as a stray answer in the review list.

import { describe, expect, it } from 'vitest'

import {
  AI_OVERRIDE_KEY,
  type AiOverride,
  overridePercent,
  readAiOverride,
  withAiOverride,
  withoutAiOverride,
} from '@/features/review/ai-override'
import { criterionKey } from '@/features/review/plan-editor'

const OVERRIDE: AiOverride = {
  percent: 75,
  recommendation: 'yes',
  note: 'The abstract is stronger than the pre-screen read it.',
  by: 'Nick',
  at: '2026-08-11T09:00:00.000Z',
}

describe('overridePercent', () => {
  it('takes the number an organizer typed', () => {
    expect(overridePercent('72')).toBe(72)
    expect(overridePercent(' 72 ')).toBe(72)
  })

  it('clamps rather than rejects at the edges, so a slip is not a refused save', () => {
    expect(overridePercent('105')).toBe(100)
    expect(overridePercent('-4')).toBe(0)
  })

  it('rounds, because the stored score is a whole percent everywhere it is rendered', () => {
    expect(overridePercent('72.6')).toBe(73)
  })

  it('refuses what is not a number at all, because there is nothing to guess', () => {
    expect(overridePercent('')).toBeUndefined()
    expect(overridePercent('high')).toBeUndefined()
    expect(overridePercent(Number.NaN)).toBeUndefined()
  })
})

describe('round trip', () => {
  it('reads back what it wrote', () => {
    expect(readAiOverride(withAiOverride({}, OVERRIDE))).toEqual(OVERRIDE)
  })

  it('leaves the reviewer notes beside it alone', () => {
    const notes = withAiOverride({ relevance: 'A strong fit for the track.' }, OVERRIDE)
    expect(notes['relevance']).toBe('A strong fit for the track.')
    expect(readAiOverride(notes)?.percent).toBe(75)
  })

  it('clears back to exactly the notes that were there before', () => {
    const before = { relevance: 'A strong fit for the track.' }
    expect(withoutAiOverride(withAiOverride(before, OVERRIDE))).toEqual(before)
    expect(readAiOverride(withoutAiOverride(withAiOverride(before, OVERRIDE)))).toBeUndefined()
  })

  it('is absent on a review nobody has overridden', () => {
    expect(readAiOverride({})).toBeUndefined()
    expect(readAiOverride(undefined)).toBeUndefined()
  })
})

describe('a blob that came out of Airtable', () => {
  // Total on purpose: this is parsed inside a cached read that renders the whole submission
  // detail, so a throw here would cost the page rather than the badge.
  it('answers "no override" for anything malformed rather than throwing', () => {
    expect(readAiOverride({ [AI_OVERRIDE_KEY]: 'not json' })).toBeUndefined()
    expect(readAiOverride({ [AI_OVERRIDE_KEY]: '[]' })).toBeUndefined()
    expect(readAiOverride({ [AI_OVERRIDE_KEY]: 'null' })).toBeUndefined()
    expect(readAiOverride({ [AI_OVERRIDE_KEY]: '{}' })).toBeUndefined()
    expect(readAiOverride({ [AI_OVERRIDE_KEY]: '   ' })).toBeUndefined()
  })

  it('requires the three fields that make it an override at all', () => {
    // A percent with nobody attached is not an override, it is a number: the panel says
    // "Overridden by X on Y", and there is no honest way to render that from this.
    expect(readAiOverride({ [AI_OVERRIDE_KEY]: JSON.stringify({ percent: 70 }) })).toBeUndefined()
    expect(
      readAiOverride({ [AI_OVERRIDE_KEY]: JSON.stringify({ by: 'Nick', at: '2026-08-11' }) }),
    ).toBeUndefined()
  })

  it('drops a recommendation that is not one of the three', () => {
    const stored = JSON.stringify({ ...OVERRIDE, recommendation: 'strong accept' })
    expect(readAiOverride({ [AI_OVERRIDE_KEY]: stored })?.recommendation).toBeUndefined()
  })

  it('clamps a stored percent, so a hand-edited cell cannot render 900%', () => {
    const stored = JSON.stringify({ ...OVERRIDE, percent: 900 })
    expect(readAiOverride({ [AI_OVERRIDE_KEY]: stored })?.percent).toBe(100)
  })
})

describe('the reserved key cannot be a criterion', () => {
  it('is not a key the rubric editor can generate, whatever the label', () => {
    const labels = ['__aiOverride', '_ai override', 'AI Override', '🤖', '__ai_override__']
    for (const label of labels) {
      expect(criterionKey(label, [])).not.toBe(AI_OVERRIDE_KEY)
    }
  })
})
