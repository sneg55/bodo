// Mapping is where silent data corruption would live, so the records below are
// written by hand in Airtable's own shape rather than round-tripped through the
// mappers. Every case here is a way a real base differs from the naive guess:
// links arrive as arrays, an unchecked checkbox is an absent key, an autonumber is
// a number, and a JSON blob column is just text until something validates it.

import { describe, expect, it } from 'vitest'

import { isAppError } from '@/constants/errorIds'
import { mapParticipant, mapSpeaker, mapSubmission } from '@/services/airtable/mapping'
import type { AirtableRecord } from '@/services/airtable/records'

function record(id: string, fields: Record<string, unknown>): AirtableRecord {
  return { id, fields }
}

/** The minimum a Submissions row needs before anything optional is interesting. */
const SUBMISSION_CORE = {
  event: ['recEvent1'],
  submitter: ['recSpk1'],
  code: 7,
  title: 'Evaluating agents without a golden dataset',
  status: 'accepted',
}

function errorId(thrown: unknown): string {
  return isAppError(thrown) ? thrown.id : `not an AppError: ${String(thrown)}`
}

function caught(fn: () => unknown): unknown {
  try {
    fn()
    return undefined
  } catch (error) {
    return error
  }
}

describe('mapSubmission', () => {
  it('collapses single links to scalar ids and keeps multi-links as arrays', () => {
    const submission = mapSubmission(
      record('recSub1', {
        ...SUBMISSION_CORE,
        track: ['recTrack2'],
        room: ['recRoom1'],
        form: ['recForm1'],
        tags: ['recTag1', 'recTag3'],
      }),
    )

    // The array is Airtable's, not ours: `trackId === ['recTrack2']` would compare
    // unequal to every track id the app holds.
    expect(submission.trackId).toBe('recTrack2')
    expect(submission.roomId).toBe('recRoom1')
    expect(submission.formId).toBe('recForm1')
    expect(submission.tagIds).toEqual(['recTag1', 'recTag3'])
    expect(submission.eventId).toBe('recEvent1')
    expect(submission.submitterId).toBe('recSpk1')
  })

  it('renders the autonumber code as SESS-<n>', () => {
    expect(mapSubmission(record('recSub1', SUBMISSION_CORE)).code).toBe('SESS-7')
  })

  it('leaves an already-prefixed code alone and prefixes a bare string', () => {
    const prefixed = mapSubmission(record('recSub1', { ...SUBMISSION_CORE, code: 'SESS-12' }))
    const bare = mapSubmission(record('recSub1', { ...SUBMISSION_CORE, code: '12' }))

    expect(prefixed.code).toBe('SESS-12')
    expect(bare.code).toBe('SESS-12')
  })

  it('reads an absent checkbox as false, not undefined', () => {
    const submission = mapSubmission(record('recSub1', SUBMISSION_CORE))

    // Airtable omits an unchecked checkbox entirely. `reviewRequired: undefined`
    // would put a confirmed sponsor into the review queue via a falsy check.
    expect(submission.reviewRequired).toBe(false)
  })

  it('parses answersJson into an object', () => {
    const submission = mapSubmission(
      record('recSub1', {
        ...SUBMISSION_CORE,
        answersJson: '{"fld_desc":"<p>How to build evals.</p>","fld_lab":"Docker"}',
      }),
    )

    expect(submission.answers).toEqual({
      fld_desc: '<p>How to build evals.</p>',
      fld_lab: 'Docker',
    })
  })

  it('defaults the orthogonal scheduling and calendar columns', () => {
    const submission = mapSubmission(record('recSub1', SUBMISSION_CORE))

    expect(submission.scheduleStatus).toBe('unscheduled')
    expect(submission.calendarStatus).toBe('active')
    expect(submission.calendarSequence).toBe(0)
    expect(submission.source).toBe('form')
  })

  it('names the record when answersJson is not valid JSON', () => {
    const thrown = caught(() =>
      mapSubmission(record('recSub9', { ...SUBMISSION_CORE, answersJson: '{"fld_desc":' })),
    )

    expect(errorId(thrown)).toBe('E_DATA_002')
    expect(isAppError(thrown) ? thrown.message : '').toContain('recSub9')
    expect(isAppError(thrown) ? thrown.context.field : '').toBe('answersJson')
  })

  it('rejects a status outside the lifecycle rather than passing it through', () => {
    const thrown = caught(() =>
      mapSubmission(record('recSub1', { ...SUBMISSION_CORE, status: 'Accepted' })),
    )

    // Case matters: 'Accepted' would never match a filter written against the
    // lifecycle vocabulary, so the row would just quietly vanish from every tab.
    expect(errorId(thrown)).toBe('E_DATA_002')
  })

  it('rejects a missing required link instead of inventing an empty id', () => {
    const thrown = caught(() =>
      mapSubmission(record('recSub1', { ...SUBMISSION_CORE, submitter: [] })),
    )

    expect(errorId(thrown)).toBe('E_DATA_002')
  })
})

describe('mapSpeaker', () => {
  it('parses the links blob and tolerates unknown keys', () => {
    const speaker = mapSpeaker(
      record('recSpk1', {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Okafor',
        linksJson: '{"linkedin":"https://linkedin.com/in/example","mastodon":"ignored"}',
      }),
    )

    expect(speaker.links).toEqual({ linkedin: 'https://linkedin.com/in/example' })
  })

  it('falls back to the `links` column name from section 3', () => {
    const speaker = mapSpeaker(
      record('recSpk1', {
        email: 'ada@example.com',
        links: '{"website":"https://example.com"}',
      }),
    )

    expect(speaker.links.website).toBe('https://example.com')
  })

  it('reads a half-filled profile without throwing', () => {
    // A speaker record is created from an email at CFP step 2, before any name is
    // collected, so an empty firstName is a normal state and not a data error.
    const speaker = mapSpeaker(record('recSpk2', { email: 'new@example.com' }))

    expect(speaker.firstName).toBe('')
    expect(speaker.lastName).toBe('')
    expect(speaker.links).toEqual({})
  })
})

describe('mapParticipant', () => {
  it('maps a co-speaker row with its ordering', () => {
    const participant = mapParticipant(
      record('recPar2', {
        submission: ['recSub1'],
        speaker: ['recSpk3'],
        role: 'co_speaker',
        sortOrder: 2,
      }),
    )

    expect(participant).toEqual({
      id: 'recPar2',
      submissionId: 'recSub1',
      speakerId: 'recSpk3',
      role: 'co_speaker',
      isPrimary: false,
      sortOrder: 2,
    })
  })

  it('treats a blank role as a speaker', () => {
    const participant = mapParticipant(
      record('recPar3', { submission: ['recSub1'], speaker: ['recSpk1'], isPrimary: true }),
    )

    expect(participant.role).toBe('speaker')
    expect(participant.isPrimary).toBe(true)
  })
})
