import { describe, expect, it } from 'vitest'

import { projectAgendaData } from '@/features/agenda/read-model'
import {
  FIXTURE_EVENT,
  FIXTURE_FORM,
  FIXTURE_PARTICIPANTS,
  FIXTURE_ROOMS,
  FIXTURE_SPEAKERS,
  FIXTURE_SUBMISSIONS,
  FIXTURE_TAGS,
  FIXTURE_TRACKS,
} from '@/services/airtable/fixtures'
import type { SubmissionWithParticipants } from '@/types/domain'

function joinedSubmissions(): readonly SubmissionWithParticipants[] {
  const speakerById = new Map(FIXTURE_SPEAKERS.map((speaker) => [speaker.id, speaker]))
  return FIXTURE_SUBMISSIONS.map((submission) => ({
    ...submission,
    participants: FIXTURE_PARTICIPANTS.filter(
      (participant) => participant.submissionId === submission.id,
    ).flatMap((participant) => {
      const speaker = speakerById.get(participant.speakerId)
      return speaker === undefined ? [] : [{ ...participant, speaker }]
    }),
  }))
}

function fixtureAgenda() {
  return projectAgendaData({
    event: FIXTURE_EVENT,
    submissions: joinedSubmissions(),
    rooms: FIXTURE_ROOMS,
    tracks: FIXTURE_TRACKS,
    tags: FIXTURE_TAGS,
    forms: [FIXTURE_FORM],
  })
}

describe('projectAgendaData', () => {
  it('projects only accepted rows into the scheduling surface', () => {
    const agenda = fixtureAgenda()

    expect(agenda.sessions.map((session) => session.id)).toEqual(['fixSub1', 'fixSub2', 'fixSub6'])
  })

  it('resolves rooms, tracks, tags, and source labels before crossing the client boundary', () => {
    const agenda = fixtureAgenda()
    const scheduled = agenda.sessions.find((session) => session.id === 'fixSub1')
    const manual = agenda.sessions.find((session) => session.id === 'fixSub6')

    expect(scheduled).toMatchObject({
      room: 'Main Stage',
      track: 'Evals',
      sourceName: FIXTURE_FORM.name,
    })
    expect(manual).toMatchObject({ sourceName: 'Manual', tags: ['Sponsor'] })
  })

  it('keeps every participant in the session and deduplicates the speaker picker', () => {
    const agenda = fixtureAgenda()
    const session = agenda.sessions.find((row) => row.id === 'fixSub1')

    expect(session?.participants.map((participant) => participant.id)).toEqual([
      'fixSpk1',
      'fixSpk3',
    ])
    expect(new Set(agenda.speakers.map((speaker) => speaker.id)).size).toBe(agenda.speakers.length)
  })
})
