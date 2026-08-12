// The status tables. Sessionboard's is the identity on all five of its values, which is
// precisely why it is tested: an identity mapping that stops being one produces sessions
// with a status no filter matches, and nothing raises an error on the way.

import { describe, expect, it } from 'vitest'

import { SUBMISSION_STATUSES } from '@/constants/status'
import {
  ACCELEVENTS_IMPORTED_STATUS,
  isSessionboardStatus,
  mapAcceleventsStatus,
  mapSessionboardStatus,
  mapSessionizeStatus,
  SESSIONBOARD_STATUS_FALLBACK,
  SESSIONBOARD_STATUS_MAP,
  SESSIONBOARD_STATUSES,
} from '@/features/imports/status-map'

describe('sessionboard status map', () => {
  it('maps every value their enum has, with nothing missing', () => {
    expect(Object.keys(SESSIONBOARD_STATUS_MAP).sort()).toEqual([...SESSIONBOARD_STATUSES].sort())
  })

  it('is the identity on all five, and each target is a real bodo status', () => {
    for (const status of SESSIONBOARD_STATUSES) {
      const mapped = mapSessionboardStatus(status)
      expect(mapped).toEqual({ status, recognized: true })
      expect(SUBMISSION_STATUSES).toContain(mapped.status)
    }
  })

  it('does not claim bodo statuses Sessionboard has no equivalent for', () => {
    const targets = Object.values(SESSIONBOARD_STATUS_MAP)
    expect(targets).not.toContain('draft')
    expect(targets).not.toContain('withdrawn')
  })

  it('normalises case and whitespace before matching', () => {
    expect(mapSessionboardStatus(' Accept_Queue ')).toEqual({
      status: 'accept_queue',
      recognized: true,
    })
  })

  it('falls back to pending and says it did not recognise the value', () => {
    for (const unknown of ['shortlisted', '', null, undefined]) {
      expect(mapSessionboardStatus(unknown)).toEqual({
        status: SESSIONBOARD_STATUS_FALLBACK,
        recognized: false,
      })
    }
    // Pending and not draft: a draft is speaker-editable and invisible to review, so an
    // unmapped status would land as content the organizer never sees.
    expect(SESSIONBOARD_STATUS_FALLBACK).toBe('pending')
  })

  it('guards the enum', () => {
    expect(isSessionboardStatus('declined')).toBe(true)
    expect(isSessionboardStatus('withdrawn')).toBe(false)
  })
})

describe('sessionize status', () => {
  it('only ever produces accepted, because only accepted sessions are exposed', () => {
    expect(mapSessionizeStatus({ status: 'Accepted', isServiceSession: false })).toEqual({
      kind: 'submission',
      status: 'accepted',
    })
    // No status at all is still an exposed session, so still accepted. Returning
    // pending here would invent a review backlog out of decisions already made.
    expect(mapSessionizeStatus({ status: null, isServiceSession: false })).toEqual({
      kind: 'submission',
      status: 'accepted',
    })
  })

  it('sends a service session to the agenda instead of to a status', () => {
    expect(mapSessionizeStatus({ status: null, isServiceSession: true })).toEqual({
      kind: 'agenda_only',
      reason: 'service_session',
    })
  })
})

describe('accelevents status', () => {
  it('imports a published programme as accepted', () => {
    expect(mapAcceleventsStatus()).toBe('accepted')
    expect(SUBMISSION_STATUSES).toContain(ACCELEVENTS_IMPORTED_STATUS)
  })
})
