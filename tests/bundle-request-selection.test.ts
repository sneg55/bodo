// Ticked file REQUESTS resolved to files, and the unmet obligations kept in view.
//
// The rule under test is the one the coordinator asked for by name: a ticked request nobody
// has delivered is excluded from the archive and COUNTED BY NAME, never silently dropped. An
// organizer who ticks seven rows and gets four files cannot otherwise tell an undelivered
// document from a broken export, and those need very different responses.

import { describe, expect, it } from 'vitest'

import {
  MAX_BUNDLE_REQUESTS,
  requestBundlePlan,
  unfulfilledNotice,
} from '@/features/bundle/request-selection'

const REQUESTS = [
  { id: 'req-release', title: 'Signed release form' },
  { id: 'req-headshot', title: 'Headshot' },
  { id: 'req-bio', title: 'Bio' },
]

const ASSIGNMENTS = [
  { id: 'asg-1', fileRequestId: 'req-release' },
  { id: 'asg-2', fileRequestId: 'req-release' },
  { id: 'asg-3', fileRequestId: 'req-headshot' },
  // req-bio is assigned to nobody at all, which is a different kind of unfulfilled.
]

const FILES = [
  { id: 'f-1', fileRequestAssignmentId: 'asg-1' },
  { id: 'f-2', fileRequestAssignmentId: 'asg-1' },
  // asg-2 and asg-3 are assigned and unanswered.
  { id: 'f-deck' },
]

function plan(checkedRequestIds: readonly string[]) {
  return requestBundlePlan({
    eventRequests: REQUESTS,
    checkedRequestIds,
    assignments: ASSIGNMENTS,
    files: FILES,
  })
}

describe('resolving requests to files', () => {
  it('walks request to assignment to file', () => {
    expect(plan(['req-release']).fileIds).toEqual(['f-1', 'f-2'])
  })

  it('keeps every version, leaving the latest-version rule to the read that follows', () => {
    // Two files against one assignment. Collapsing them here would duplicate the rule that
    // already lives in `promoteToLatest`, and the two would drift.
    expect(plan(['req-release']).fileIds).toHaveLength(2)
  })

  it('ignores a file delivered against an unticked request', () => {
    expect(plan(['req-headshot']).fileIds).toEqual([])
  })

  it('ignores a file that answers no request at all', () => {
    expect(plan(['req-release', 'req-headshot', 'req-bio']).fileIds).not.toContain('f-deck')
  })
})

describe('unmet obligations', () => {
  it('names a request that is assigned but unanswered', () => {
    expect(plan(['req-headshot']).unfulfilledTitles).toEqual(['Headshot'])
  })

  it('names a request nobody has been assigned yet', () => {
    expect(plan(['req-bio']).unfulfilledTitles).toEqual(['Bio'])
  })

  it('counts the delivered ones and names only the rest', () => {
    const result = plan(['req-release', 'req-headshot', 'req-bio'])

    expect(result.fulfilled).toBe(1)
    expect(result.unfulfilledTitles).toEqual(['Headshot', 'Bio'])
  })

  it('names nothing when every ticked request was delivered', () => {
    expect(plan(['req-release']).unfulfilledTitles).toEqual([])
  })

  it('names them in the event request order rather than the tick order', () => {
    expect(plan(['req-bio', 'req-headshot']).unfulfilledTitles).toEqual(['Headshot', 'Bio'])
  })
})

describe('scope', () => {
  it('drops a request id the event does not hold, and counts it', () => {
    const result = plan(['req-release', 'recFromAnotherConference'])

    expect(result.fileIds).toEqual(['f-1', 'f-2'])
    expect(result.foreign).toBe(1)
    expect(result.unfulfilledTitles).toEqual([])
  })

  it('never reaches a file through an assignment of an unticked request', () => {
    // asg-1 belongs to req-release. Ticking only the foreign id must resolve to nothing.
    expect(plan(['recFromAnotherConference']).fileIds).toEqual([])
  })

  it('reports an empty selection rather than treating it as everything', () => {
    expect(plan([]).problem).toBe('empty')
    expect(plan([]).fileIds).toEqual([])
  })

  it('reports a selection past the cap', () => {
    const many = Array.from({ length: MAX_BUNDLE_REQUESTS + 1 }, (_, index) => ({
      id: `req-${String(index)}`,
      title: `Request ${String(index)}`,
    }))

    const result = requestBundlePlan({
      eventRequests: many,
      checkedRequestIds: many.map((request) => request.id),
      assignments: [],
      files: [],
    })

    expect(result.problem).toBe('too-many')
  })
})

describe('unfulfilledNotice', () => {
  it('says nothing when everything ticked was delivered', () => {
    expect(unfulfilledNotice(plan(['req-release']))).toBeUndefined()
  })

  it('reads as a singular sentence for one undelivered request', () => {
    expect(unfulfilledNotice(plan(['req-headshot']))).toBe(
      '1 selected file request has no upload yet, so nothing from it is in this archive: Headshot.',
    )
  })

  it('names the undelivered requests when there are several', () => {
    expect(unfulfilledNotice(plan(['req-release', 'req-headshot', 'req-bio']))).toBe(
      '2 selected file requests have no upload yet, so nothing from them is in this archive: Headshot, Bio.',
    )
  })

  it('caps the names rather than printing a paragraph', () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      id: `req-${String(index)}`,
      title: `Doc ${String(index)}`,
    }))
    const result = requestBundlePlan({
      eventRequests: many,
      checkedRequestIds: many.map((request) => request.id),
      assignments: [],
      files: [],
    })

    expect(unfulfilledNotice(result)).toContain('Doc 0, Doc 1, Doc 2 and 3 more.')
  })
})
