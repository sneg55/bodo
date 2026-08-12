// The merge rules: what a merge is allowed to consume, and what it does to the cast.
//
// Both halves are pure and both are tested here rather than through the UI, because a merge
// deletes records and Airtable has no undo this app can reach. `checkMerge` is the guard the
// Server Action runs; `planParticipantMerge` is what decides which SubmissionParticipants
// rows are deleted rather than repointed.

import { describe, expect, it } from 'vitest'

import { checkMerge, MERGE_MAX_RECORDS, mergeSummary } from '@/features/crm/merge'
import { type ParticipantRow, planParticipantMerge } from '@/services/airtable/mutations-crm-relink'

const reachable = new Set(['s1', 's2', 's3'])

describe('checkMerge', () => {
  it('plans the absorbed records as everything except the primary', () => {
    const checked = checkMerge({ primaryId: 's1', speakerIds: ['s1', 's2', 's3'] }, reachable)

    expect(checked).toEqual({ ok: true, plan: { primaryId: 's1', absorbedIds: ['s2', 's3'] } })
  })

  it('refuses a merge of one record', () => {
    expect(checkMerge({ primaryId: 's1', speakerIds: ['s1'] }, reachable).ok).toBe(false)
  })

  it('treats a repeated id as one record rather than as a self-merge', () => {
    const checked = checkMerge({ primaryId: 's1', speakerIds: ['s1', 's1'] }, reachable)

    // Deduplicated to a single id, which is then "pick at least two" rather than a plan that
    // absorbs s1 into s1 and deletes the record it just kept.
    expect(checked.ok).toBe(false)
  })

  it('refuses when the primary is not among the selected records', () => {
    expect(checkMerge({ primaryId: 's9', speakerIds: ['s1', 's2'] }, reachable).ok).toBe(false)
  })

  it('refuses a record the caller cannot reach, which is the security property', () => {
    const checked = checkMerge({ primaryId: 's1', speakerIds: ['s1', 'sOther'] }, reachable)

    expect(checked.ok).toBe(false)
    // One answer for "not yours" and "not there", so an id cannot be probed for existence.
    expect(checked.ok ? '' : checked.reason).toContain('not one you can edit')
  })

  it('refuses a primary the caller cannot reach either', () => {
    expect(checkMerge({ primaryId: 'sOther', speakerIds: ['sOther', 's1'] }, reachable).ok).toBe(
      false,
    )
  })

  it('caps one merge, so a mis-click cannot delete the directory', () => {
    const ids = Array.from({ length: MERGE_MAX_RECORDS + 1 }, (_, index) => `s${index}`)
    const checked = checkMerge({ primaryId: 's0', speakerIds: ids }, new Set(ids))

    expect(checked.ok).toBe(false)
  })

  it('allows exactly the cap', () => {
    const ids = Array.from({ length: MERGE_MAX_RECORDS }, (_, index) => `s${index}`)

    expect(checkMerge({ primaryId: 's0', speakerIds: ids }, new Set(ids)).ok).toBe(true)
  })
})

describe('mergeSummary', () => {
  it('names the count, the records going, and the one that survives', () => {
    const summary = mergeSummary('Priya Raman', ['Priya Raman', 'P. Raman'])

    expect(summary).toContain('2 records')
    expect(summary).toContain('P. Raman')
    expect(summary).toContain('Priya Raman')
    expect(summary).toContain('cannot be undone')
  })

  it('says record, singular, for one', () => {
    expect(mergeSummary('Ada Okafor', ['A. Okafor'])).toContain('1 record (')
  })
})

const cast = (
  id: string,
  submissionId: string | undefined,
  speakerId: string,
  isPrimary = false,
): ParticipantRow => ({ id, submissionId, speakerId, isPrimary })

describe('planParticipantMerge', () => {
  it('repoints a session the survivor is not on', () => {
    const plan = planParticipantMerge([cast('p1', 'sub1', 's2')], new Set(['s2']), 's1')

    expect(plan.patches).toEqual([{ id: 'p1', fields: { speaker: ['s1'] } }])
    expect(plan.removals).toEqual([])
    expect(plan.repointed).toBe(1)
  })

  it('deletes the absorbed row when the survivor is already cast on that session', () => {
    const plan = planParticipantMerge(
      [cast('p1', 'sub1', 's1'), cast('p2', 'sub1', 's2')],
      new Set(['s2']),
      's1',
    )

    expect(plan.removals).toEqual(['p2'])
    expect(plan.patches).toEqual([])
  })

  it('collapses two absorbed records on one session to a single row', () => {
    const plan = planParticipantMerge(
      [cast('p1', 'sub1', 's2'), cast('p2', 'sub1', 's3')],
      new Set(['s2', 's3']),
      's1',
    )

    expect(plan.patches).toEqual([{ id: 'p1', fields: { speaker: ['s1'] } }])
    expect(plan.removals).toEqual(['p2'])
  })

  it('promotes the survivor when the row it replaces was the primary presenter', () => {
    const plan = planParticipantMerge(
      [cast('p1', 'sub1', 's1'), cast('p2', 'sub1', 's2', true)],
      new Set(['s2']),
      's1',
    )

    expect(plan.removals).toEqual(['p2'])
    expect(plan.patches).toEqual([{ id: 'p1', fields: { isPrimary: true } }])
    // The promotion is not a repoint, so the count the toast reports stays honest.
    expect(plan.repointed).toBe(0)
  })

  it('does not promote a survivor that is already the primary', () => {
    const plan = planParticipantMerge(
      [cast('p1', 'sub1', 's1', true), cast('p2', 'sub1', 's2', true)],
      new Set(['s2']),
      's1',
    )

    expect(plan.patches).toEqual([])
  })

  it('leaves rows for other speakers alone', () => {
    const plan = planParticipantMerge(
      [cast('p1', 'sub1', 'sOther'), cast('p2', 'sub2', 's2')],
      new Set(['s2']),
      's1',
    )

    expect(plan.patches).toEqual([{ id: 'p2', fields: { speaker: ['s1'] } }])
    expect(plan.removals).toEqual([])
  })

  it('repoints a row with no submission link rather than deleting it', () => {
    // It should not exist, but this decides what gets deleted, and "cannot happen" is not a
    // safe basis for a delete.
    const plan = planParticipantMerge(
      [cast('p1', undefined, 's2'), cast('p2', undefined, 's3')],
      new Set(['s2', 's3']),
      's1',
    )

    expect(plan.removals).toEqual([])
    expect(plan.patches).toHaveLength(2)
  })
})
