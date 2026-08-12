// Assigning a task to speakers an organizer names, rather than to the accepted cohort.
//
// The rule worth pinning is not "it returns the speakers you asked for". It is that the
// speakers it returns carry the SAME accepted submissions the bulk path would have used, that
// an id which is not on the event's roster is refused rather than skipped, and that a
// combination which would silently write nothing is reported as such. That last one is what
// made SPK-09 unjudgeable: a submission-scoped task assigned to somebody with no accepted
// session writes no row, and without `unreachableScopes` the organizer gets a success and the
// speaker gets an empty portal.

import { describe, expect, it } from 'vitest'

import {
  assignableSpeakers,
  chosenSpeakerScopes,
  unreachableScopes,
} from '@/features/tasks/roster-scope'
import type { Task } from '@/types/domain'

import {
  CO_SPEAKER,
  OWNER,
  participant,
  STRANGER,
  speaker,
  submission,
  task,
} from './helpers/portal-fakes'

const accepted = { status: 'accepted' as const }

/** Three people on the roster; only OWNER has anything accepted. */
const ROSTER = [
  speaker({ id: OWNER, firstName: 'Ada', lastName: 'Okafor', email: 'ada@example.com' }),
  speaker({
    id: CO_SPEAKER,
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'grace@example.com',
    status: 'confirmed',
  }),
  speaker({
    id: STRANGER,
    firstName: 'Barbara',
    lastName: 'Liskov',
    email: 'barbara@example.com',
    status: 'prospect',
  }),
]

const SUBMISSIONS = [
  submission({ id: 'recSubA', ...accepted }, [participant({ speakerId: OWNER })]),
  // Not accepted, so the co-speaker on it is reachable ONLY by being named.
  submission({ id: 'recSubB', status: 'pending' }, [
    participant({ speakerId: CO_SPEAKER, submissionId: 'recSubB' }),
  ]),
]

const contactTask: Task = task({ id: 'recTaskContact', entityType: 'contact' })
const submissionTask: Task = task({ id: 'recTaskSub', entityType: 'submission' })

describe('assignableSpeakers', () => {
  it('offers the whole roster, not only the accepted cast', () => {
    // The hole this fills: a confirmed speaker with nothing accepted, and a prospect, were
    // both unreachable because "Assign to accepted speakers" was the only path.
    const rows = assignableSpeakers({ speakers: ROSTER, submissions: SUBMISSIONS })

    expect(rows.map((row) => row.id)).toEqual([OWNER, STRANGER, CO_SPEAKER])
  })

  it('sorts by display name so the picker does not reshuffle between reads', () => {
    const rows = assignableSpeakers({ speakers: ROSTER, submissions: SUBMISSIONS })

    expect(rows.map((row) => row.name)).toEqual(['Ada Okafor', 'Barbara Liskov', 'Grace Hopper'])
  })

  it('counts accepted submissions, which is what says whether a submission task can reach them', () => {
    const rows = assignableSpeakers({ speakers: ROSTER, submissions: SUBMISSIONS })
    const counts = Object.fromEntries(rows.map((row) => [row.id, row.acceptedSubmissions]))

    expect(counts).toEqual({ [OWNER]: 1, [CO_SPEAKER]: 0, [STRANGER]: 0 })
  })

  it('reads an absent status as prospect, as every surface that groups by it does', () => {
    const rows = assignableSpeakers({ speakers: [speaker({ id: OWNER })], submissions: [] })

    expect(rows[0]?.status).toBe('prospect')
  })

  it('falls back to the email for a record with no name', () => {
    const rows = assignableSpeakers({
      speakers: [speaker({ id: OWNER, firstName: '', lastName: '', email: 'ada@example.com' })],
      submissions: [],
    })

    expect(rows[0]?.name).toBe('ada@example.com')
  })
})

describe('chosenSpeakerScopes', () => {
  it('carries the accepted submissions the bulk path would have used', () => {
    // Not a second reading of "accepted": the ids come from `acceptedSpeakerScopes`, so a
    // submission task assigned by hand lands on exactly the sessions the fan-out uses.
    const { scopes } = chosenSpeakerScopes({
      speakers: ROSTER,
      submissions: SUBMISSIONS,
      speakerIds: [OWNER],
    })

    expect(scopes).toHaveLength(1)
    expect(scopes[0]?.submissionIds).toEqual(['recSubA'])
  })

  it('scopes a speaker with nothing accepted to no submissions, rather than dropping them', () => {
    const { scopes } = chosenSpeakerScopes({
      speakers: ROSTER,
      submissions: SUBMISSIONS,
      speakerIds: [CO_SPEAKER],
    })

    expect(scopes.map((scope) => scope.speaker.id)).toEqual([CO_SPEAKER])
    expect(scopes[0]?.submissionIds).toEqual([])
  })

  it('reports an id that is not on this event, so the action can refuse it', () => {
    // A speaker id is client input. Resolving it against the authorized event's own roster
    // is what stops an admin of one event putting a task on another event's speaker.
    const { scopes, unknown } = chosenSpeakerScopes({
      speakers: ROSTER,
      submissions: SUBMISSIONS,
      speakerIds: [OWNER, 'recSpeakerFromAnotherEvent'],
    })

    expect(unknown).toEqual(['recSpeakerFromAnotherEvent'])
    expect(scopes.map((scope) => scope.speaker.id)).toEqual([OWNER])
  })

  it('counts a repeated id once, so the reported speaker count is believable', () => {
    const { scopes } = chosenSpeakerScopes({
      speakers: ROSTER,
      submissions: SUBMISSIONS,
      speakerIds: [OWNER, OWNER, CO_SPEAKER],
    })

    expect(scopes).toHaveLength(2)
  })

  it('returns nothing for an empty selection', () => {
    const { scopes, unknown } = chosenSpeakerScopes({
      speakers: ROSTER,
      submissions: SUBMISSIONS,
      speakerIds: [],
    })

    expect(scopes).toEqual([])
    expect(unknown).toEqual([])
  })
})

describe('unreachableScopes', () => {
  it('names nobody for a contact task, which reaches anyone on the roster', () => {
    const { scopes } = chosenSpeakerScopes({
      speakers: ROSTER,
      submissions: SUBMISSIONS,
      speakerIds: [OWNER, CO_SPEAKER, STRANGER],
    })

    expect(unreachableScopes({ tasks: [contactTask], scopes })).toEqual([])
  })

  it('names the speakers a submission task would write nothing for', () => {
    // The exact shape of the SPK-09 failure: press Assign, get a success, and the portal of
    // a speaker with no accepted session stays empty.
    const { scopes } = chosenSpeakerScopes({
      speakers: ROSTER,
      submissions: SUBMISSIONS,
      speakerIds: [OWNER, CO_SPEAKER, STRANGER],
    })

    expect(unreachableScopes({ tasks: [submissionTask], scopes }).map((s) => s.speaker.id)).toEqual(
      [STRANGER, CO_SPEAKER],
    )
  })

  it('names nobody when one of the selected tasks is a contact task', () => {
    // A mixed run still reaches everybody with something, so nothing is reported: the
    // question is whether this speaker gets a row at all, not whether they get every row.
    const { scopes } = chosenSpeakerScopes({
      speakers: ROSTER,
      submissions: SUBMISSIONS,
      speakerIds: [CO_SPEAKER],
    })

    expect(unreachableScopes({ tasks: [submissionTask, contactTask], scopes })).toEqual([])
  })
})
