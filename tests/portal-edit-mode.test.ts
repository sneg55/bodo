// The three edit modes from BUILD_SPEC 5.2, and specifically the combinations.
//
// Each individual rule is one line of code; what is worth asserting is that they compose
// in the right ORDER. A decided submission on a form that is still open has to stay
// read-only, and getting that precedence backwards would reopen every accepted abstract
// the moment an organizer extended a deadline.

import { describe, expect, it } from 'vitest'

import { SUBMISSION_STATUSES } from '@/constants/status'
import { submissionEditPermission } from '@/features/portal/edit-mode'

describe('submissionEditPermission', () => {
  it('is fully editable for a draft on an open form', () => {
    const permission = submissionEditPermission({ status: 'draft', formAcceptsUpdates: true })

    expect(permission.mode).toBe('full')
    expect(permission.bodyEditable).toBe(true)
    // A draft has never been submitted, so there is no update for an organizer to hear about.
    expect(permission.alertsAdminsOnSave).toBe(false)
  })

  it('allows body edits after submit while the form still accepts updates, and alerts admins', () => {
    const permission = submissionEditPermission({ status: 'pending', formAcceptsUpdates: true })

    expect(permission.mode).toBe('body_updates')
    expect(permission.bodyEditable).toBe(true)
    expect(permission.alertsAdminsOnSave).toBe(true)
  })

  it.each(['accepted', 'declined'] as const)('freezes the body once %s', (status) => {
    const permission = submissionEditPermission({ status, formAcceptsUpdates: true })

    expect(permission.mode).toBe('body_locked')
    expect(permission.bodyEditable).toBe(false)
    expect(permission.alertsAdminsOnSave).toBe(false)
  })

  it('keeps a decided submission read-only even when the form is still open', () => {
    // The ordering test. If the form's state were checked first, extending a deadline
    // would silently reopen every accepted abstract for editing.
    expect(
      submissionEditPermission({ status: 'accepted', formAcceptsUpdates: true }).bodyEditable,
    ).toBe(false)
  })

  it('freezes a draft whose form has closed', () => {
    const permission = submissionEditPermission({ status: 'draft', formAcceptsUpdates: false })

    expect(permission.mode).toBe('body_locked')
    expect(permission.detail).toContain('has closed')
  })

  it('freezes a submission with no form at all, because there is nothing to edit through', () => {
    // A manual submission: the caller passes formAcceptsUpdates: false.
    expect(submissionEditPermission({ status: 'pending', formAcceptsUpdates: false }).mode).toBe(
      'body_locked',
    )
  })

  it('answers for every status in the lifecycle, and states its mode every time', () => {
    for (const status of SUBMISSION_STATUSES) {
      const permission = submissionEditPermission({ status, formAcceptsUpdates: true })
      expect(permission.title).not.toBe('')
      expect(permission.detail).not.toBe('')
      expect(['full', 'body_updates', 'body_locked']).toContain(permission.mode)
    }
  })

  it('never claims an admin alert for a submission whose body is frozen', () => {
    for (const status of SUBMISSION_STATUSES) {
      for (const formAcceptsUpdates of [true, false]) {
        const permission = submissionEditPermission({ status, formAcceptsUpdates })
        if (!permission.bodyEditable) expect(permission.alertsAdminsOnSave).toBe(false)
      }
    }
  })
})
