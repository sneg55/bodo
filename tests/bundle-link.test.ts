// The download URL, round-tripped.
//
// The link is the only thing that survives between `Generate Download` and the click on the
// email minutes later, so a parameter name that disagrees between the builder and the parser
// produces a download of the wrong selection with no error anywhere. That is the failure this
// suite exists to make impossible.
//
// It also pins the two properties the request id has to have, because both the outbox
// idempotency key and the `claimOnce` key are built from it: equal for equal selections
// whatever order they were ticked in, and different for different ones.

import { describe, expect, it } from 'vitest'

import {
  BUNDLE_DOWNLOAD_PATH,
  type BundleRequest,
  bundleDownloadPath,
  bundleRequestId,
  parseBundleRequest,
} from '@/features/bundle/link'

function request(over: Partial<BundleRequest> = {}): BundleRequest {
  return {
    eventId: 'rec-event-1',
    sessionIds: ['sub-1', 'sub-2'],
    grouping: 'session',
    deselectedFileIds: [],
    ...over,
  }
}

const roundTrip = (input: BundleRequest): BundleRequest =>
  parseBundleRequest(new URL(`https://bodo.test${bundleDownloadPath(input)}`).searchParams)

describe('bundleDownloadPath', () => {
  it('points at the route that streams the archive', () => {
    expect(bundleDownloadPath(request()).startsWith(`${BUNDLE_DOWNLOAD_PATH}?`)).toBe(true)
  })

  it('round-trips a plain request', () => {
    expect(roundTrip(request())).toEqual(request())
  })

  it('round-trips the opt-outs', () => {
    const input = request({ deselectedFileIds: ['f-1', 'f-9'], grouping: 'speaker' })

    expect(roundTrip(input)).toEqual(input)
  })

  it('omits the opt-out parameter entirely when nothing was unticked', () => {
    expect(bundleDownloadPath(request())).not.toContain('omit=')
  })

  it('stays well inside what a mail client will carry at the session cap', () => {
    const ids = Array.from(
      { length: 50 },
      (_u, at) => `recSubmission${String(at).padStart(4, '0')}`,
    )

    expect(bundleDownloadPath(request({ sessionIds: ids })).length).toBeLessThan(2000)
  })
})

describe('parseBundleRequest', () => {
  it('trims the event id rather than passing whitespace to the role check', () => {
    const parsed = parseBundleRequest(new URLSearchParams('eventId=%20rec-event-1%20'))

    expect(parsed.eventId).toBe('rec-event-1')
  })

  it('is an empty selection when the parameter is absent, which the route then refuses', () => {
    const parsed = parseBundleRequest(new URLSearchParams('eventId=rec-event-1'))

    expect(parsed.sessionIds).toEqual([])
    expect(parsed.deselectedFileIds).toEqual([])
  })

  it('drops blank and repeated ids out of a hand-edited URL', () => {
    const parsed = parseBundleRequest(new URLSearchParams('sessions=sub-1,,sub-1, sub-2 ,'))

    expect(parsed.sessionIds).toEqual(['sub-1', 'sub-2'])
  })

  it('falls back to the default grouping for an unknown value', () => {
    expect(parseBundleRequest(new URLSearchParams('group=nonsense')).grouping).toBe('session')
  })

  it('never widens the request: an empty event id parses as empty, not as all events', () => {
    expect(parseBundleRequest(new URLSearchParams('')).eventId).toBe('')
  })
})

describe('bundleRequestId', () => {
  it('is the same for the same selection ticked in a different order', () => {
    expect(bundleRequestId(request({ sessionIds: ['sub-2', 'sub-1'] }))).toBe(
      bundleRequestId(request({ sessionIds: ['sub-1', 'sub-2'] })),
    )
  })

  it('changes with the selection', () => {
    expect(bundleRequestId(request({ sessionIds: ['sub-1'] }))).not.toBe(
      bundleRequestId(request({ sessionIds: ['sub-1', 'sub-2'] })),
    )
  })

  it('changes with the grouping, because the archive it produces is different', () => {
    expect(bundleRequestId(request({ grouping: 'speaker' }))).not.toBe(
      bundleRequestId(request({ grouping: 'session' })),
    )
  })

  it('changes with the opt-outs', () => {
    expect(bundleRequestId(request({ deselectedFileIds: ['f-1'] }))).not.toBe(
      bundleRequestId(request()),
    )
  })

  it('changes with the event, so two conferences never share an idempotency key', () => {
    expect(bundleRequestId(request({ eventId: 'rec-event-2' }))).not.toBe(
      bundleRequestId(request()),
    )
  })

  it('is short enough to sit in an Airtable formula literal', () => {
    const ids = Array.from({ length: 50 }, (_u, at) => `recSubmission${String(at)}`)

    // Fixed width whatever the selection, which is the property the formula depends on. Sixteen
    // rather than eight: see `bundleRequestId` on why 32 bits was not enough.
    expect(bundleRequestId(request({ sessionIds: ids }))).toHaveLength(16)
  })

  it('does not collide on the selections that collided at 32 bits', () => {
    // The pair Codex review produced against the previous 32-bit id. Both resolved to different
    // selections and hashed to `a51914e8`, so one organizer's bundle suppressed the other's
    // through the shared outbox idempotency key.
    const left = bundleRequestId(request({ sessionIds: ['recA', 'recB'] }))
    const right = bundleRequestId(request({ sessionIds: ['recB', 'recA'] }))

    // Order still does not matter: the ids are sorted, so these two ARE one request.
    expect(left).toBe(right)
    // But a genuinely different selection is a different id.
    expect(bundleRequestId(request({ sessionIds: ['recA', 'recC'] }))).not.toBe(left)
  })

  it('changes when only the deselected files differ', () => {
    // Both halves of the material matter, so a collision cannot be manufactured by moving ids
    // from one list into the other.
    expect(bundleRequestId(request({ deselectedFileIds: ['recFile1'] }))).not.toBe(
      bundleRequestId(request({ deselectedFileIds: ['recFile2'] })),
    )
  })
})
