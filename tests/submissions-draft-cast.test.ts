// Who ends up on a draft.
//
// The draft used to record the submitter alone, and the stated reason was that the portal
// roster was READ-ONLY, so a cast written here could never be corrected. ABS-11 removed
// that wall, so the cast is carried, and this file pins the three things that stops it
// becoming a way to create records from a public endpoint:
//
//   - a participant with no usable email is DROPPED rather than turned into a junk
//     Speakers row, since `upsertSpeakerByEmail` keys on the address;
//   - the form's role MAXIMA are enforced, by the same `validateParticipants` the submit
//     path uses, so a draft cannot hold a cast the submit would refuse;
//   - the role MINIMA are not, because not having added the second speaker yet is the
//     state a draft exists to represent.

import { describe, expect, it } from 'vitest'

import { ProblemCodes } from '@/features/forms/validate'
import { draftCast } from '@/features/submissions/draft-cast'
import type { Form } from '@/types/forms'

import { CFP_FORM, cfpPayload, soloSpeaker } from './helpers/cfp-form'

function cast(form: Form = CFP_FORM, participants = [soloSpeaker()]) {
  return draftCast({ form, payload: cfpPayload({ participants }), eventId: 'recEvent1' })
}

function expectCast(result: ReturnType<typeof draftCast>) {
  if (!result.ok) {
    throw new Error(`unexpected problems: ${result.problems.map((p) => p.message).join('; ')}`)
  }
  return result.participants
}

const MARCUS = soloSpeaker({
  key: 'p2',
  role: 'co_speaker',
  isPrimary: false,
  email: 'marcus@example.com',
  firstName: 'Marcus',
  lastName: 'Okafor',
})

describe('draftCast', () => {
  it('carries a co-speaker alongside the submitter, in order', () => {
    const participants = expectCast(cast(CFP_FORM, [soloSpeaker(), MARCUS]))

    expect(participants.map((entry) => entry.draft.email)).toEqual([
      'ada@example.com',
      'marcus@example.com',
    ])
    expect(participants.map((entry) => entry.isPrimary)).toEqual([true, false])
    expect(participants.map((entry) => entry.sortOrder)).toEqual([1, 2])
  })

  it('falls back to the submitter when no participants have been reached yet', () => {
    // The wizard only seeds the primary on the way INTO the Participant step, so a draft
    // saved from the Submission step posts none at all. Without this fallback `checkPrimary`
    // refuses it for having no primary, and saving early is the main thing the button is for.
    const participants = expectCast(cast(CFP_FORM, []))

    expect(participants).toHaveLength(1)
    expect(participants[0].draft.email).toBe('ada@example.com')
    expect(participants[0].isPrimary).toBe(true)
  })

  it('drops a half-typed participant rather than creating a junk Speakers row', () => {
    const halfTyped = soloSpeaker({ key: 'p3', role: 'co_speaker', isPrimary: false, email: 'ma' })
    const participants = expectCast(cast(CFP_FORM, [soloSpeaker(), halfTyped]))

    expect(participants.map((entry) => entry.draft.email)).toEqual(['ada@example.com'])
  })

  it('collapses one person listed twice, keeping the primary', () => {
    // `upsertSpeakers` on the submit path dedupes the same way: one address is one Speakers
    // row, and two participant rows for it would make every roster count wrong.
    const again = soloSpeaker({ key: 'p4', role: 'co_speaker', isPrimary: false })
    const participants = expectCast(cast(CFP_FORM, [soloSpeaker(), again]))

    expect(participants).toHaveLength(1)
    expect(participants[0].isPrimary).toBe(true)
  })

  it('normalises the address the draft is keyed on', () => {
    const shouty = soloSpeaker({ email: '  ADA@Example.com ' })
    expect(expectCast(cast(CFP_FORM, [shouty]))[0].draft.email).toBe('ada@example.com')
  })

  it('carries a mapped participant answer through to the Speakers row', () => {
    // The wizard's Biography question maps to the speaker profile. The draft is now where a
    // co-author's bio is first written, because the speaker submits from the PORTAL after a
    // save and that path never re-reads wizard answers.
    const withBio = soloSpeaker({ answers: { p_bio: 'Builds evaluation harnesses.' } })
    expect(expectCast(cast(CFP_FORM, [withBio]))[0].draft.bio).toBe('Builds evaluation harnesses.')
  })

  it('refuses a cast past the form’s role maximum', () => {
    // Not pedantry: the same row is what gets submitted, so a cast stored now that the
    // submit would reject strands the speaker's work in a record they cannot send.
    const capped: Form = {
      ...CFP_FORM,
      roles: [
        { role: 'speaker', enabled: true, min: 1, max: 1 },
        { role: 'co_speaker', enabled: true, min: 0, max: 1 },
      ],
    }
    const result = cast(capped, [
      soloSpeaker(),
      MARCUS,
      soloSpeaker({ key: 'p5', role: 'co_speaker', isPrimary: false, email: 'dara@example.com' }),
    ])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((problem) => problem.code)).toContain(ProblemCodes.ROLE_MAX)
  })

  it('does not refuse a cast that is merely unfinished', () => {
    const demanding: Form = {
      ...CFP_FORM,
      roles: [
        { role: 'speaker', enabled: true, min: 1, max: 1 },
        { role: 'co_speaker', enabled: true, min: 2, max: 4 },
      ],
    }
    expect(cast(demanding, [soloSpeaker()]).ok).toBe(true)
  })

  it('files a solo submitter under the first ENABLED role, not merely the first', () => {
    // `firstEnabledRole` in wizard-state.ts reads `roles.at(0)` and is only ever right
    // because `toPublicForm` filters the disabled roles out before the client sees them.
    // This path is handed a full `Form`, so it shares `primaryRole` with the submit path:
    // the draft's participant row IS the submitted one, and a role the organizer switched
    // off would otherwise survive all the way onto the submission.
    const disabledFirst: Form = {
      ...CFP_FORM,
      participantsEnabled: false,
      roles: [
        { role: 'moderator', enabled: false, min: 0, max: 1 },
        { role: 'co_speaker', enabled: true, min: 1, max: 4 },
      ],
    }
    expect(expectCast(cast(disabledFirst))[0].role).toBe('co_speaker')
  })
})
