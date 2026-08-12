import { describe, expect, it } from 'vitest'

import {
  checkTagName,
  isSpeakerTagColor,
  knownTagIds,
  nextTagColor,
  nextTagIds,
  SPEAKER_TAG_COLORS,
  SPEAKER_TAG_NAME_MAX,
} from '@/features/crm/tag-vocabulary'
import type { SpeakerTag } from '@/types/domain'

const tag = (id: string, name: string): SpeakerTag => ({ id, name, color: '#64748b' })

describe('checkTagName', () => {
  it('rejects an empty name', () => {
    expect(checkTagName('  ', []).ok).toBe(false)
  })

  it('rejects a duplicate, case-insensitively, across the whole global vocabulary', () => {
    expect(checkTagName('KEYNOTE', [tag('t1', 'Keynote')]).ok).toBe(false)
  })

  it('rejects a name past the chip limit', () => {
    expect(checkTagName('x'.repeat(SPEAKER_TAG_NAME_MAX + 1), []).ok).toBe(false)
  })

  it('accepts a fresh name', () => {
    expect(checkTagName('Workshop', [tag('t1', 'Keynote')])).toEqual({ ok: true })
  })
})

describe('isSpeakerTagColor', () => {
  it('accepts every colour the palette offers', () => {
    expect(SPEAKER_TAG_COLORS.every((choice) => isSpeakerTagColor(choice.value))).toBe(true)
  })

  it('refuses anything outside the palette, so every chip is drawn from one ramp', () => {
    expect(isSpeakerTagColor('red; background-image: url(x)')).toBe(false)
    expect(isSpeakerTagColor('#123456')).toBe(false)
  })
})

describe('knownTagIds', () => {
  const vocabulary = [tag('t1', 'Keynote'), tag('t2', 'Workshop'), tag('t3', 'Sponsor')]

  it('keeps only ids the vocabulary knows, in the vocabulary order', () => {
    expect(knownTagIds(['t3', 't1', 'gone'], vocabulary)).toEqual(['t1', 't3'])
  })

  it('deduplicates', () => {
    expect(knownTagIds(['t2', 't2'], vocabulary)).toEqual(['t2'])
  })

  it('is empty when everything is cleared', () => {
    expect(knownTagIds([], vocabulary)).toEqual([])
  })
})

describe('nextTagIds', () => {
  const KEYNOTE = tag('t1', 'Keynote')
  const WORKSHOP = tag('t2', 'Workshop')

  it('adds a tag that is not applied', () => {
    expect(nextTagIds([KEYNOTE], 't2')).toEqual(['t1', 't2'])
  })

  it('removes one that is', () => {
    expect(nextTagIds([KEYNOTE, WORKSHOP], 't1')).toEqual(['t2'])
  })

  it('empties the set when the last chip goes', () => {
    expect(nextTagIds([KEYNOTE], 't1')).toEqual([])
  })

  // WHY THE EDITOR MUST SERIALISE ITS WRITES. `setSpeakerTags` replaces membership rather
  // than diffing it, so a write is only as correct as the set it was computed from. Two
  // toggles computed from the SAME `tags` prop - which is what a second click before the
  // first round trip re-renders produces - each discard the other's change, and whichever
  // lands second wins. The fix is the `pending` guard in `SpeakerTagEditor`, which was
  // decorative until the transition was given an async scope function; that guard is React
  // scheduling and is not assertable here (this repo's vitest environment is `node`, with no
  // renderer and no testing-library). What IS assertable is that the race destroys data
  // rather than merely repeating work, which is the reason the guard has to hold.
  it('shows why two toggles off one stale set lose a write', () => {
    const current = [KEYNOTE]
    const addA = nextTagIds(current, 't2')
    const addB = nextTagIds(current, 't3')

    expect(addA).toEqual(['t1', 't2'])
    expect(addB).toEqual(['t1', 't3'])
    // Neither is the union. Whichever request lands second is the stored membership, so the
    // other click is silently gone.
    expect(addB).not.toContain('t2')
  })
})

describe('nextTagColor', () => {
  it('starts at the head of the palette for an empty vocabulary', () => {
    expect(nextTagColor([])).toBe(SPEAKER_TAG_COLORS[0]?.value)
  })

  it('cycles rather than running out, and always answers with a palette colour', () => {
    const many = Array.from({ length: SPEAKER_TAG_COLORS.length * 2 + 3 }, (_, index) =>
      tag(`t${String(index)}`, `Tag ${String(index)}`),
    )
    expect(isSpeakerTagColor(nextTagColor(many))).toBe(true)
  })
})
