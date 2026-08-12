import { describe, expect, it } from 'vitest'

import { buildPortalContacts } from '@/features/portal-config/contacts'
import type { SubmissionParticipant } from '@/types/domain'

import { participant, speaker, submission } from './helpers/portal-fakes'

const EVENT = 'recEvent1'
const OTHER_EVENT = 'recEvent2'

const ADA = speaker({ id: 'recAda', company: 'Acme' })
const BEN = speaker({ id: 'recBen' })

function row(over: Partial<SubmissionParticipant> & { speakerId: string }): SubmissionParticipant {
  const { speaker: _resolved, ...plain } = participant(over)
  return plain
}

describe('buildPortalContacts', () => {
  it('produces a contact for a speaker with no submissions at all', () => {
    const [contact] = buildPortalContacts(EVENT, [ADA], [], [])

    // No roles and no sessions is the default portal's most typical member, not an edge
    // case to be dropped.
    expect(contact).toEqual({
      speakerId: 'recAda',
      company: 'Acme',
      roles: [],
      sessions: [],
    })
  })

  it('gives the submitter the submitter role even with no participant row of their own', () => {
    const sub = submission({ id: 'recSub1', submitterId: 'recBen' }, [])

    const [contact] = buildPortalContacts(EVENT, [BEN], [sub], [])

    expect(contact.roles).toEqual(['submitter'])
    expect(contact.sessions.map((one) => one.submissionId)).toEqual(['recSub1'])
  })

  it('collects every participant role a person holds, deduped and in vocabulary order', () => {
    const one = submission({ id: 'recSub1' }, [])
    const two = submission({ id: 'recSub2' }, [])

    const [contact] = buildPortalContacts(
      EVENT,
      [ADA],
      [one, two],
      [
        row({ id: 'p1', submissionId: 'recSub2', speakerId: 'recAda', role: 'moderator' }),
        row({ id: 'p2', submissionId: 'recSub1', speakerId: 'recAda', role: 'speaker' }),
        row({ id: 'p3', submissionId: 'recSub2', speakerId: 'recAda', role: 'speaker' }),
      ],
    )

    expect(contact.roles).toEqual(['speaker', 'moderator'])
  })

  it('carries the session facts a filter can test, one entry per submission', () => {
    const sub = submission({
      id: 'recSub1',
      submitterId: 'recBen',
      format: 'Panel',
      level: 'Advanced',
      language: 'English',
      trackId: 'recTrackAi',
      tagIds: ['recTag1'],
    })

    const [contact] = buildPortalContacts(
      EVENT,
      [ADA],
      [sub],
      [row({ id: 'p1', submissionId: 'recSub1', speakerId: 'recAda' })],
    )

    expect(contact.sessions).toEqual([
      {
        submissionId: 'recSub1',
        format: 'Panel',
        level: 'Advanced',
        language: 'English',
        trackId: 'recTrackAi',
        tagIds: ['recTag1'],
      },
    ])
  })

  it('lists a session once when the same person submitted it and presents on it', () => {
    const sub = submission({ id: 'recSub1', submitterId: 'recAda' }, [])

    const [contact] = buildPortalContacts(
      EVENT,
      [ADA],
      [sub],
      [row({ id: 'p1', submissionId: 'recSub1', speakerId: 'recAda' })],
    )

    expect(contact.sessions).toHaveLength(1)
    expect(contact.roles).toEqual(['speaker', 'submitter'])
  })

  it('ignores a submission belonging to another event, and every row hanging off it', () => {
    const foreign = submission({
      id: 'recSubX',
      eventId: OTHER_EVENT,
      submitterId: 'recAda',
      trackId: 'recTrackKeynote',
    })

    const [contact] = buildPortalContacts(
      EVENT,
      [ADA],
      [foreign],
      [row({ id: 'p1', submissionId: 'recSubX', speakerId: 'recAda', role: 'chairperson' })],
    )

    expect(contact.roles).toEqual([])
    expect(contact.sessions).toEqual([])
  })

  it('drops a participant row pointing at a submission the caller did not pass', () => {
    const [contact] = buildPortalContacts(
      EVENT,
      [ADA],
      [],
      [row({ id: 'p1', submissionId: 'recGhost', speakerId: 'recAda' })],
    )

    expect(contact.roles).toEqual([])
  })

  it('orders sessions on submission id, so two reads of the same data agree', () => {
    const first = submission({ id: 'recSubA', submitterId: 'recAda' }, [])
    const second = submission({ id: 'recSubB', submitterId: 'recAda' }, [])

    const [contact] = buildPortalContacts(EVENT, [ADA], [second, first], [])

    expect(contact.sessions.map((one) => one.submissionId)).toEqual(['recSubA', 'recSubB'])
  })

  it('keeps the speakers in the order the caller sorted them', () => {
    const contacts = buildPortalContacts(EVENT, [BEN, ADA], [], [])

    expect(contacts.map((one) => one.speakerId)).toEqual(['recBen', 'recAda'])
  })

  it('ignores a participant row for somebody who is not on the event roster', () => {
    const sub = submission({ id: 'recSub1', submitterId: 'recAda' }, [])

    const contacts = buildPortalContacts(
      EVENT,
      [ADA],
      [sub],
      [row({ id: 'p1', submissionId: 'recSub1', speakerId: 'recStranger' })],
    )

    expect(contacts.map((one) => one.speakerId)).toEqual(['recAda'])
  })
})
