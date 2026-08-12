// The seed's idempotency, at the level where it is decided.
//
// `partitionRows` is the whole mechanism: Airtable has no unique index, so "already
// seeded" is a lookup and not a constraint. The property that makes it sound is that
// one key function runs over both the record read back and the field set about to be
// written, so the two sides cannot drift.

import { describe, expect, it } from 'vitest'

import { indexByKey, keyFromValues, keyOfFields, keyOn, partitionRows } from '../scripts/seed/keys'

const bySlug = keyOn(['slug'])
const byTuple = keyOn(['submission', 'speaker', 'role'])

describe('keyOn', () => {
  it('reads a plain text column', () => {
    expect(bySlug({ id: 'rec1', fields: { slug: 'ai-engineer-sandbox' } })).toBe(
      'ai-engineer-sandbox',
    )
  })

  it('treats a missing column as empty rather than throwing', () => {
    expect(bySlug({ id: 'rec1', fields: {} })).toBe('')
  })

  it('flattens a link array, which is how Airtable always sends a link', () => {
    const key = byTuple({
      id: 'rec1',
      fields: { submission: ['recSub'], speaker: ['recSpk'], role: 'co_speaker' },
    })
    expect(key).toBe('["recSub"]|["recSpk"]|co_speaker')
  })

  it('does not depend on the order a multi-link arrived in', () => {
    const byTags = keyOn(['tags'])
    const one = byTags({ id: 'a', fields: { tags: ['recB', 'recA'] } })
    const other = byTags({ id: 'b', fields: { tags: ['recA', 'recB'] } })
    expect(one).toBe(other)
  })

  it('keeps a blank optional part distinct from a filled one', () => {
    const contactTask = byTuple({
      id: 'a',
      fields: { submission: [], speaker: ['recS'], role: '' },
    })
    const submissionTask = byTuple({
      id: 'b',
      fields: { submission: ['recX'], speaker: ['recS'], role: '' },
    })
    expect(contactTask).not.toBe(submissionTask)
  })
})

describe('keyOfFields and keyFromValues agree with keyOn', () => {
  it('gives a row about to be written the same key it will read back with', () => {
    const fields = { submission: ['recSub'], speaker: ['recSpk'], role: 'speaker' }
    expect(keyOfFields(byTuple, fields)).toBe(byTuple({ id: 'recNew', fields }))
  })

  it('lets a caller look a row up by its key values without spelling the key', () => {
    const fields = { submission: ['recSub'], speaker: ['recSpk'], role: 'speaker' }
    expect(keyFromValues([['recSub'], ['recSpk'], 'speaker'])).toBe(keyOfFields(byTuple, fields))
  })
})

describe('partitionRows', () => {
  const rows = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }]

  it('creates everything against an empty base', () => {
    const split = partitionRows(new Set(), rows, bySlug)
    expect(split.create).toHaveLength(3)
    expect(split.present).toBe(0)
  })

  it('creates nothing on a second run, which is the whole point', () => {
    const split = partitionRows(new Set(['a', 'b', 'c']), rows, bySlug)
    expect(split.create).toEqual([])
    expect(split.present).toBe(3)
  })

  it('creates only the gap when a run was interrupted halfway', () => {
    const split = partitionRows(new Set(['a']), rows, bySlug)
    expect(split.create).toEqual([{ slug: 'b' }, { slug: 'c' }])
    expect(split.present).toBe(1)
  })

  it('deduplicates within its own input, so one run cannot create a pair', () => {
    const split = partitionRows(new Set(), [{ slug: 'a' }, { slug: 'a' }], bySlug)
    expect(split.create).toEqual([{ slug: 'a' }])
    expect(split.duplicates).toBe(1)
  })

  it('preserves input order, so `order` columns come out as declared', () => {
    const split = partitionRows(new Set(), [{ slug: 'c' }, { slug: 'a' }], bySlug)
    expect(split.create.map((row) => row.slug)).toEqual(['c', 'a'])
  })
})

describe('indexByKey', () => {
  it('maps a natural key to the record id later steps link against', () => {
    const index = indexByKey(
      [
        { id: 'rec1', fields: { slug: 'a' } },
        { id: 'rec2', fields: { slug: 'b' } },
      ],
      bySlug,
    )
    expect(index.get('b')).toBe('rec2')
  })
})
