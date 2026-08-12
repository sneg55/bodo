// The refusals. This is the file that proves the portal is not "authorized by layout".
//
// BUILD_SPEC 4: a layout is not a security boundary, so a Server Action reachable by POST
// has to verify that the record belongs to the acting speaker. The failure being tested is
// the one that looks like nothing at all in a browser: a speaker changing the code in a
// URL, or posting a different assignment id at the same action, and getting somebody
// else's record back.

import { describe, expect, it } from 'vitest'

import {
  assertOwnsAssignment,
  assertOwnsFile,
  assertOwnsSubmission,
} from '@/features/portal/authorize'
import { syncErrorIdOf } from './helpers/auth-fakes'
import {
  assignment,
  CO_SPEAKER,
  OWNER,
  participant,
  STRANGER,
  storedFile,
  submission,
  task,
} from './helpers/portal-fakes'

const owner = { kind: 'speaker', speakerId: OWNER } as const
const coSpeaker = { kind: 'speaker', speakerId: CO_SPEAKER } as const
const stranger = { kind: 'speaker', speakerId: STRANGER } as const
const admin = { kind: 'user', userId: 'recUser1' } as const

const withCast = submission({}, [
  participant({ speakerId: OWNER, isPrimary: true, sortOrder: 1 }),
  participant({ speakerId: CO_SPEAKER, role: 'co_speaker', isPrimary: false, sortOrder: 2 }),
])

describe('assertOwnsSubmission', () => {
  it('allows the submitter', () => {
    expect(assertOwnsSubmission(owner, withCast)).toBe(OWNER)
  })

  it('allows a co-speaker who did not file it', () => {
    // The session is theirs even though the abstract was not. Keying on `submitter` alone
    // would show a co-speaker an empty portal for a talk they are giving.
    expect(assertOwnsSubmission(coSpeaker, withCast)).toBe(CO_SPEAKER)
  })

  it('refuses a speaker who is neither the submitter nor on the roster', () => {
    expect(syncErrorIdOf(() => assertOwnsSubmission(stranger, withCast))).toBe('E_AUTH_005')
  })

  it('refuses an admin subject rather than trusting it', () => {
    // Impersonation works by holding a speaker session, so a `user` subject reaching a
    // portal mutation means it was called from the wrong surface.
    expect(syncErrorIdOf(() => assertOwnsSubmission(admin, withCast))).toBe('E_AUTH_005')
  })

  it('refuses a submission whose cast is empty and whose submitter is somebody else', () => {
    const foreign = submission({ submitterId: STRANGER }, [])
    expect(syncErrorIdOf(() => assertOwnsSubmission(owner, foreign))).toBe('E_AUTH_005')
  })
})

describe('assertOwnsAssignment', () => {
  const item = { assignment: assignment({ speakerId: OWNER }), task: task() }

  it('allows the assigned speaker', () => {
    expect(assertOwnsAssignment(owner, item)).toBe(OWNER)
  })

  it('refuses any other speaker, so one speaker cannot complete another one task', () => {
    expect(syncErrorIdOf(() => assertOwnsAssignment(stranger, item))).toBe('E_AUTH_005')
  })

  it('refuses a co-speaker on the same submission', () => {
    // A task assignment belongs to exactly one person, unlike the submission it hangs off.
    expect(syncErrorIdOf(() => assertOwnsAssignment(coSpeaker, item))).toBe('E_AUTH_005')
  })
})

describe('assertOwnsFile', () => {
  it('allows the uploader and refuses everyone else', () => {
    const file = storedFile({ speakerId: OWNER })
    expect(assertOwnsFile(owner, file)).toBe(OWNER)
    expect(syncErrorIdOf(() => assertOwnsFile(stranger, file))).toBe('E_AUTH_005')
  })
})
