// Who may be added to a submission's cast and who may be taken off it.
//
// ABS-11 asked for the controls; these are the rules behind them, and two of them are not
// preferences:
//
//   - the primary cannot be removed, or the reminder sweep drops the draft (`draftsOf` in
//     reminders-wiring.ts) and a decision has nobody to notify (`SUB_NO_RECIPIENTS`);
//   - the role limits are the FORM's, evaluated by the same `validateParticipants` the
//     public wizard uses, so the portal cannot accept a cast the submit path would refuse.

import { describe, expect, it } from 'vitest'

import { ProblemCodes } from '@/features/forms/validate'
import type { EditPermission } from '@/features/portal/edit-mode'
import {
  additionProblems,
  assignableRoles,
  type RosterMember,
  removalProblems,
  rosterEditable,
} from '@/features/portal/roster-rules'
import type { ParticipantRoleRule } from '@/types/forms'

const ROLES: readonly ParticipantRoleRule[] = [
  { role: 'speaker', enabled: true, min: 1, max: 1 },
  { role: 'co_speaker', enabled: true, min: 0, max: 2 },
  { role: 'moderator', enabled: false, min: 0, max: 1 },
]

const PRIMARY: RosterMember = {
  id: 'recPar1',
  speakerId: 'recSpeaker1',
  email: 'ada@example.com',
  role: 'speaker',
  isPrimary: true,
}

function member(overrides: Partial<RosterMember>): RosterMember {
  return { ...PRIMARY, id: 'recPar2', isPrimary: false, role: 'co_speaker', ...overrides }
}

function permission(overrides: Partial<EditPermission>): EditPermission {
  return {
    mode: 'full',
    bodyEditable: true,
    alertsAdminsOnSave: false,
    title: '',
    detail: '',
    ...overrides,
  }
}

function add(overrides: Partial<Parameters<typeof additionProblems>[0]> = {}) {
  return additionProblems({
    roster: [PRIMARY],
    roles: ROLES,
    email: 'marcus@example.com',
    role: 'co_speaker',
    ...overrides,
  })
}

describe('rosterEditable', () => {
  it('follows the body, so a frozen submission has a frozen cast', () => {
    // The same flag that decides whether the answers render as a form. A form past its
    // close date yields `body_locked`, which is what keeps CFP-16 passing.
    expect(rosterEditable(permission({ mode: 'full' }))).toBe(true)
    expect(rosterEditable(permission({ mode: 'body_updates' }))).toBe(true)
    expect(rosterEditable(permission({ mode: 'body_locked', bodyEditable: false }))).toBe(false)
  })
})

describe('assignableRoles', () => {
  it('offers the enabled roles with the labels the wizard uses', () => {
    expect(assignableRoles(ROLES)).toEqual([
      { role: 'speaker', label: 'Speaker' },
      { role: 'co_speaker', label: 'Co-Speaker' },
    ])
  })

  it('offers nothing when the organizer disabled every role', () => {
    expect(assignableRoles([{ role: 'speaker', enabled: false, min: 0, max: 1 }])).toEqual([])
  })
})

describe('additionProblems', () => {
  it('accepts an ordinary co-speaker', () => {
    expect(add()).toEqual([])
  })

  it('refuses a blank or malformed address', () => {
    expect(add({ email: '  ' }).map((problem) => problem.code)).toEqual([ProblemCodes.REQUIRED])
    expect(add({ email: 'marcus' }).map((problem) => problem.code)).toEqual([
      ProblemCodes.EMAIL_INVALID,
    ])
  })

  it('refuses somebody already on the roster, whatever the case', () => {
    // Two rows for one person make the roster count wrong and therefore the role rules
    // wrong, and `ownSubmissions` would return the submission twice.
    expect(add({ email: 'ADA@Example.com ' }).map((problem) => problem.message)).toEqual([
      'That person is already on this submission.',
    ])
  })

  it('refuses a role this form does not offer', () => {
    expect(add({ role: 'moderator' }).map((problem) => problem.code)).toEqual([
      ProblemCodes.ROLE_NOT_ENABLED,
    ])
  })

  it('refuses the add that would exceed the role maximum', () => {
    const full = [PRIMARY, member({ id: 'a' }), member({ id: 'b' })]
    expect(add({ roster: full }).map((problem) => problem.code)).toEqual([ProblemCodes.ROLE_MAX])
  })

  it('does not report a shortfall the add did not cause', () => {
    // A form whose co-speaker MINIMUM is two is already unmet before the press. Reporting
    // that as the reason the add failed is a refusal nobody can act on by pressing a
    // different button, and it would make the first of the two adds impossible.
    const demanding: readonly ParticipantRoleRule[] = [
      { role: 'speaker', enabled: true, min: 1, max: 1 },
      { role: 'co_speaker', enabled: true, min: 2, max: 4 },
    ]
    expect(add({ roles: demanding })).toEqual([])
  })
})

describe('removalProblems', () => {
  const roster = [PRIMARY, member({ id: 'recPar2' })]

  it('allows a co-speaker off', () => {
    expect(removalProblems(roster, 'recPar2')).toEqual([])
  })

  it('refuses the primary, because the submission would have nobody to notify', () => {
    expect(removalProblems(roster, PRIMARY.id).map((problem) => problem.code)).toEqual([
      ProblemCodes.PRIMARY_MISSING,
    ])
  })

  it('refuses emptying the cast even when the last row is not marked primary', () => {
    // A defensive second rule rather than a duplicate of the one above: a submission
    // imported without a primary flag would otherwise be removable down to nothing.
    const orphan = [member({ id: 'recParOnly', isPrimary: false })]
    expect(removalProblems(orphan, 'recParOnly').map((problem) => problem.code)).toEqual([
      ProblemCodes.ROLE_MIN,
    ])
  })

  it('refuses a participant id that is not on this submission', () => {
    expect(removalProblems(roster, 'recParElsewhere')).toHaveLength(1)
  })
})
