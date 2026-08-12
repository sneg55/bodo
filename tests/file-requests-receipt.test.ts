// Which assignment an upload satisfies, and when marking it received is a no-op.

import { describe, expect, it } from 'vitest'

import { plannedReceipt, resolveRequestTarget } from '@/features/file-requests/receipt'
import type { FileRequestItem } from '@/services/airtable/reads-requests'

import { fileRequest, OWNER, requestItem } from './helpers/portal-fakes'

const NOW = '2026-08-08T12:00:00.000Z'

const release = fileRequest({
  id: 'recReqRelease',
  entityType: 'contact',
  title: 'Signed speaker release',
})
const slides = fileRequest({ id: 'recReqSlides', entityType: 'submission', title: 'Slides' })

function pending(id: string, request = release, submissionId?: string): FileRequestItem {
  return requestItem({ request, assignment: { id, submissionId, status: 'pending' } })
}

function received(id: string, request = release, submissionId?: string): FileRequestItem {
  return requestItem({
    request,
    assignment: { id, submissionId, status: 'received', receivedAt: '2026-08-01T09:00:00.000Z' },
  })
}

describe('resolveRequestTarget', () => {
  it('refuses when nothing is requested of this speaker', () => {
    const target = resolveRequestTarget({ items: [], fileRequestId: 'recReqRelease' })

    expect(target).toEqual({
      ok: false,
      problem: 'not-requested',
      message: 'this file request is not open for you',
    })
  })

  it('refuses a request the speaker has no row for, even when they have others', () => {
    const target = resolveRequestTarget({
      items: [pending('recA1')],
      fileRequestId: 'recReqOther',
    })

    expect(target.ok).toBe(false)
  })

  it('resolves a contact request to its single row', () => {
    const target = resolveRequestTarget({
      items: [pending('recA1')],
      fileRequestId: 'recReqRelease',
    })

    expect(target.ok).toBe(true)
    if (!target.ok) return
    expect(target.item.assignment.id).toBe('recA1')
    expect(target.alreadyReceived).toBe(false)
  })

  it('ignores a submission the upload carries when the request is contact scoped', () => {
    const target = resolveRequestTarget({
      items: [pending('recA1')],
      fileRequestId: 'recReqRelease',
      submissionId: 'recSub1',
    })

    expect(target.ok).toBe(true)
  })

  it('resolves a submission request with one candidate without being told the session', () => {
    const target = resolveRequestTarget({
      items: [pending('recA3', slides, 'recSub1')],
      fileRequestId: 'recReqSlides',
    })

    expect(target.ok).toBe(true)
    if (!target.ok) return
    expect(target.item.assignment.submissionId).toBe('recSub1')
  })

  it('refuses as ambiguous when a speaker has several accepted submissions', () => {
    const target = resolveRequestTarget({
      items: [pending('recA3', slides, 'recSub1'), pending('recA4', slides, 'recSub2')],
      fileRequestId: 'recReqSlides',
    })

    expect(target).toEqual({
      ok: false,
      problem: 'ambiguous-submission',
      message: 'this file request is per session: say which session the file is for',
    })
  })

  it('picks the named session out of several', () => {
    const target = resolveRequestTarget({
      items: [pending('recA3', slides, 'recSub1'), pending('recA4', slides, 'recSub2')],
      fileRequestId: 'recReqSlides',
      submissionId: 'recSub2',
    })

    expect(target.ok).toBe(true)
    if (!target.ok) return
    expect(target.item.assignment.id).toBe('recA4')
  })

  it('refuses a session the request is not open for', () => {
    const target = resolveRequestTarget({
      items: [pending('recA3', slides, 'recSub1')],
      fileRequestId: 'recReqSlides',
      submissionId: 'recSub9',
    })

    expect(target).toEqual({
      ok: false,
      problem: 'wrong-submission',
      message: 'this file request is not open for that session',
    })
  })

  it('resolves duplicate rows to the same one every time', () => {
    const items = [pending('recB'), pending('recA')]
    const first = resolveRequestTarget({ items, fileRequestId: 'recReqRelease' })
    const again = resolveRequestTarget({
      items: [...items].reverse(),
      fileRequestId: 'recReqRelease',
    })

    expect(first.ok && first.item.assignment.id).toBe('recA')
    expect(again.ok && again.item.assignment.id).toBe('recA')
  })

  it('prefers the already-received duplicate, so a second upload does not flip the other', () => {
    const target = resolveRequestTarget({
      items: [pending('recA'), received('recB')],
      fileRequestId: 'recReqRelease',
    })

    expect(target.ok).toBe(true)
    if (!target.ok) return
    expect(target.item.assignment.id).toBe('recB')
    expect(target.alreadyReceived).toBe(true)
  })
})

describe('plannedReceipt', () => {
  it('plans the write for a pending row', () => {
    const target = resolveRequestTarget({
      items: [pending('recA3', slides, 'recSub1')],
      fileRequestId: 'recReqSlides',
    })

    expect(plannedReceipt(target, NOW)).toEqual({
      assignmentId: 'recA3',
      speakerId: OWNER,
      submissionId: 'recSub1',
      receivedAt: NOW,
    })
  })

  it('plans nothing for a row that is already received, so the first stamp stands', () => {
    const target = resolveRequestTarget({
      items: [received('recA1')],
      fileRequestId: 'recReqRelease',
    })

    expect(plannedReceipt(target, NOW)).toBeUndefined()
  })

  it('plans nothing when the target was refused', () => {
    const target = resolveRequestTarget({ items: [], fileRequestId: 'recReqRelease' })

    expect(plannedReceipt(target, NOW)).toBeUndefined()
  })
})
