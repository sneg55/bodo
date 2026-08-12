// Which speakers an assignment run applies to, read off the accepted submissions.

import { describe, expect, it } from 'vitest'

import { acceptedSpeakerScopes, speakerDisplayName } from '@/features/tasks/scope'

import {
  CO_SPEAKER,
  OWNER,
  participant,
  STRANGER,
  speaker,
  submission,
} from './helpers/portal-fakes'

const accepted = { status: 'accepted' as const }

describe('acceptedSpeakerScopes', () => {
  it('keeps only accepted submissions', () => {
    const scopes = acceptedSpeakerScopes([
      submission({ id: 'recSubA', ...accepted }),
      submission({ id: 'recSubB', status: 'pending' }, [
        participant({ speakerId: CO_SPEAKER, submissionId: 'recSubB' }),
      ]),
      // Staged but not committed. Notify is what tells the speaker they are in, so a
      // checklist fanned out here would arrive before the acceptance email.
      submission({ id: 'recSubC', status: 'accept_queue' }, [
        participant({ speakerId: STRANGER, submissionId: 'recSubC' }),
      ]),
    ])

    expect(scopes.map((scope) => scope.speaker.id)).toEqual([OWNER])
    expect(scopes[0]?.submissionIds).toEqual(['recSubA'])
  })

  it('includes every participant, not only the primary', () => {
    const scopes = acceptedSpeakerScopes([
      submission({ id: 'recSubA', ...accepted }, [
        participant({ speakerId: OWNER, speaker: speaker({ id: OWNER, firstName: 'Ada' }) }),
        participant({
          speakerId: CO_SPEAKER,
          isPrimary: false,
          sortOrder: 2,
          speaker: speaker({ id: CO_SPEAKER, firstName: 'Bo', lastName: 'Lin' }),
        }),
      ]),
    ])

    expect(scopes.map((scope) => scope.speaker.id)).toEqual([OWNER, CO_SPEAKER])
  })

  it('gives a speaker on three accepted submissions all three ids, once each', () => {
    const on = (id: string) => submission({ id, ...accepted }, [participant({ submissionId: id })])
    const scopes = acceptedSpeakerScopes([on('recSub1'), on('recSub2'), on('recSub3')])

    expect(scopes).toHaveLength(1)
    expect(scopes[0]?.submissionIds).toEqual(['recSub1', 'recSub2', 'recSub3'])
  })

  it('does not double a speaker listed twice on one submission', () => {
    const scopes = acceptedSpeakerScopes([
      submission({ id: 'recSubA', ...accepted }, [
        participant({ id: 'recPar1', speakerId: OWNER }),
        participant({ id: 'recPar2', speakerId: OWNER, isPrimary: false, sortOrder: 2 }),
      ]),
    ])

    expect(scopes).toHaveLength(1)
    expect(scopes[0]?.submissionIds).toEqual(['recSubA'])
  })

  it('returns nothing when no submission is accepted', () => {
    expect(acceptedSpeakerScopes([submission({ status: 'pending' })])).toEqual([])
    expect(acceptedSpeakerScopes([])).toEqual([])
  })

  it('sorts by display name so the roster does not reshuffle between reads', () => {
    const scopes = acceptedSpeakerScopes([
      submission({ id: 'recSub1', ...accepted }, [
        participant({
          speakerId: 'recZed',
          speaker: speaker({ id: 'recZed', firstName: 'Zoë', lastName: 'Adeyemi' }),
        }),
        participant({
          speakerId: 'recAmy',
          speaker: speaker({ id: 'recAmy', firstName: 'Amy', lastName: 'Baptiste' }),
        }),
      ]),
    ])

    expect(scopes.map((scope) => scope.speaker.id)).toEqual(['recAmy', 'recZed'])
  })
})

describe('speakerDisplayName', () => {
  it('joins the name and falls back to the email when there is none', () => {
    expect(speakerDisplayName(speaker({ firstName: 'Ada', lastName: 'Okafor' }))).toBe('Ada Okafor')
    expect(
      speakerDisplayName(speaker({ firstName: '', lastName: '', email: 'nobody@example.com' })),
    ).toBe('nobody@example.com')
  })
})
