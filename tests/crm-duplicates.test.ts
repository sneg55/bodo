// Near-duplicate detection in the CRM directory.
//
// The case that produced this module is the last block: a second `Priya Raman` under a
// different address landed in the directory with no warning of any kind, so a name match with
// differing emails MUST be reported. The email cases pin that the rule stays in step with the
// importer's, which is the other half of `dedup.ts`'s contract.

import { describe, expect, it } from 'vitest'

import {
  type DuplicateCandidate,
  duplicateReasons,
  findDuplicateClusters,
  nameKey,
} from '@/features/crm/duplicates'

const person = (
  id: string,
  firstName: string,
  lastName: string,
  email: string,
): DuplicateCandidate => ({ id, firstName, lastName, email })

const idsOf = (clusters: ReturnType<typeof findDuplicateClusters>) =>
  clusters.map((cluster) => [...cluster.speakerIds])

describe('nameKey', () => {
  it('folds case and collapses whitespace', () => {
    expect(nameKey(person('s1', 'Priya', 'Raman', 'a@x.com'))).toBe(
      nameKey(person('s2', '  priya ', ' RAMAN  ', 'b@x.com')),
    )
  })

  it('ignores punctuation, so O’Neill and ONeill are one person', () => {
    expect(nameKey(person('s1', "O'Neill", '', 'a@x.com'))).toBe(
      nameKey(person('s2', 'ONeill', '', 'b@x.com')),
    )
  })

  it('keeps accents, because Muller and Müller are different surnames', () => {
    expect(nameKey(person('s1', 'Jan', 'Muller', 'a@x.com'))).not.toBe(
      nameKey(person('s2', 'Jan', 'Müller', 'b@x.com')),
    )
  })

  it('is empty for a record with no name at all, so it never groups the nameless', () => {
    expect(nameKey(person('s1', '', '', 'a@x.com'))).toBe('')
  })
})

describe('findDuplicateClusters', () => {
  it('reports nothing when every record is distinct', () => {
    const clusters = findDuplicateClusters([
      person('s1', 'Ada', 'Okafor', 'ada@example.com'),
      person('s2', 'Bo', 'Lin', 'bo@example.com'),
    ])

    expect(clusters).toEqual([])
  })

  it('groups the same name under two different emails, which is the case the audit found', () => {
    const clusters = findDuplicateClusters([
      person('s1', 'Priya', 'Raman', 'priya@work.com'),
      person('s2', 'Bo', 'Lin', 'bo@example.com'),
      person('s3', 'Priya', 'Raman', 'priya@personal.com'),
    ])

    expect(idsOf(clusters)).toEqual([['s1', 's3']])
    expect(clusters.at(0)?.reason).toBe('name')
    expect(clusters.at(0)?.label).toBe('Priya Raman')
  })

  it('groups on a shared email even when the names differ', () => {
    const clusters = findDuplicateClusters([
      person('s1', 'Ada', 'Okafor', 'ada@example.com'),
      person('s2', 'A.', 'Okafor-Smith', 'ADA@example.com '),
    ])

    expect(idsOf(clusters)).toEqual([['s1', 's2']])
    expect(clusters.at(0)?.reason).toBe('email')
  })

  it('normalizes the email exactly as the importer does, so the two never disagree', () => {
    // ` ADA@EXAMPLE.COM ` is `dedup.ts`'s own example of one value.
    const clusters = findDuplicateClusters([
      person('s1', 'Ada', 'Okafor', 'ada@example.com'),
      person('s2', 'Zed', 'Quill', ' ADA@EXAMPLE.COM '),
    ])

    expect(idsOf(clusters)).toEqual([['s1', 's2']])
  })

  it('merges an email pair and a name pair that share a member into one cluster', () => {
    // s1-s2 share an email, s2-s3 share a name. Offering these as two overlapping pairs
    // would let an organizer merge s2 away and then be shown a pair naming a dead record.
    const clusters = findDuplicateClusters([
      person('s1', 'Ada', 'Okafor', 'ada@example.com'),
      person('s2', 'Priya', 'Raman', 'ada@example.com'),
      person('s3', 'Priya', 'Raman', 'priya@personal.com'),
    ])

    expect(idsOf(clusters)).toEqual([['s1', 's2', 's3']])
  })

  it('calls a mixed cluster an email duplicate, which is the stronger claim', () => {
    const clusters = findDuplicateClusters([
      person('s1', 'Ada', 'Okafor', 'ada@example.com'),
      person('s2', 'Priya', 'Raman', 'ada@example.com'),
      person('s3', 'Priya', 'Raman', 'priya@personal.com'),
    ])

    expect(clusters.at(0)?.reason).toBe('email')
  })

  it('never groups two records that are merely both missing an email', () => {
    const clusters = findDuplicateClusters([
      person('s1', 'Ada', 'Okafor', ''),
      person('s2', 'Bo', 'Lin', ''),
    ])

    expect(clusters).toEqual([])
  })

  it('holds five records for one person in a single cluster', () => {
    // The audit's own state: five separate `Priya Raman` rows. One merge, not four pairs.
    const clusters = findDuplicateClusters(
      ['a', 'b', 'c', 'd', 'e'].map((suffix, index) =>
        person(`s${index}`, 'Priya', 'Raman', `priya+${suffix}@example.com`),
      ),
    )

    expect(clusters).toHaveLength(1)
    expect(clusters.at(0)?.speakerIds).toHaveLength(5)
  })

  it('keeps the input order, so the directory lists its groups as it scans', () => {
    const clusters = findDuplicateClusters([
      person('s1', 'Zoe', 'Adler', 'zoe@a.com'),
      person('s2', 'Ada', 'Okafor', 'ada@a.com'),
      person('s3', 'Zoe', 'Adler', 'zoe@b.com'),
      person('s4', 'Ada', 'Okafor', 'ada@b.com'),
    ])

    expect(idsOf(clusters)).toEqual([
      ['s1', 's3'],
      ['s2', 's4'],
    ])
  })
})

describe('duplicateReasons', () => {
  it('flattens clusters to one badge per record', () => {
    const clusters = findDuplicateClusters([
      person('s1', 'Priya', 'Raman', 'priya@work.com'),
      person('s2', 'Priya', 'Raman', 'priya@personal.com'),
      person('s3', 'Bo', 'Lin', 'bo@example.com'),
    ])

    const reasons = duplicateReasons(clusters)

    expect(reasons.get('s1')).toBe('name')
    expect(reasons.get('s2')).toBe('name')
    expect(reasons.has('s3')).toBe(false)
  })
})
