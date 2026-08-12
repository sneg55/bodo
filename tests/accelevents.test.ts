// The mock client is the demo path for R7, so it is worth testing: if it does not
// reproduce the duplicate-email failure, the lookup branch that the live API
// forces us through is dead code until the first real sync, which is the worst
// possible moment to discover it.

import { beforeEach, describe, expect, it } from 'vitest'

import { DUPLICATE_EMAIL_CODE, extractErrorCode } from '@/services/accelevents/client'
import { mockCalls, mockClient, resetMock } from '@/services/accelevents/mock'

const EVENT = 'ai-engineer-sandbox'

const SPEAKER = {
  firstName: 'Ada',
  lastName: 'Okafor',
  email: 'ada@example.com',
}

describe('mock client, speakers', () => {
  beforeEach(() => {
    resetMock()
  })

  it('assigns an opaque remote id on create', async () => {
    const ref = await mockClient.createSpeaker(EVENT, SPEAKER)

    expect(ref.remoteId).toMatch(/^spk_mock_\d+$/)
    expect(ref.existed).toBe(false)
  })

  it('rejects a second create for the same email with the documented code', async () => {
    await mockClient.createSpeaker(EVENT, SPEAKER)

    await expect(mockClient.createSpeaker(EVENT, SPEAKER)).rejects.toMatchObject({
      context: { code: DUPLICATE_EMAIL_CODE },
    })
  })

  it('treats the same email at a different event as a different speaker', async () => {
    // Accelevents ids are event-scoped, which is the whole reason remote ids live
    // in IntegrationMappings rather than on the Speakers row.
    const first = await mockClient.createSpeaker(EVENT, SPEAKER)
    const second = await mockClient.createSpeaker('another-event', SPEAKER)

    expect(second.remoteId).not.toBe(first.remoteId)
  })

  it('finds a speaker by email after create, which is the duplicate recovery path', async () => {
    const created = await mockClient.createSpeaker(EVENT, SPEAKER)

    expect(await mockClient.findSpeakerByEmail(EVENT, 'ada@example.com')).toBe(created.remoteId)
  })

  it('matches an email case-insensitively and ignoring surrounding space', async () => {
    const created = await mockClient.createSpeaker(EVENT, SPEAKER)

    expect(await mockClient.findSpeakerByEmail(EVENT, '  ADA@Example.com ')).toBe(created.remoteId)
  })

  it('returns undefined for an unknown email rather than throwing', async () => {
    expect(await mockClient.findSpeakerByEmail(EVENT, 'nobody@example.com')).toBeUndefined()
  })
})

describe('mock client, recording', () => {
  beforeEach(() => {
    resetMock()
  })

  it('records every payload so the sync log and the admin screen have content', async () => {
    await mockClient.createSpeaker(EVENT, SPEAKER)
    await mockClient.createSession(EVENT, {
      title: 'Evaluating agents',
      startTime: '2026-10-12T17:00:00.000Z',
      endTime: '2026-10-12T17:30:00.000Z',
    })
    await mockClient.createTaxonomy(EVENT, { type: 'TRACKS', name: 'Agents' })

    expect(mockCalls().map((call) => call.kind)).toEqual([
      'speaker.create',
      'session.create',
      'taxonomy.create',
    ])
  })

  it('marks an update as pre-existing so create-versus-update is observable', async () => {
    const ref = await mockClient.updateSession(EVENT, 'ses_mock_0001', {
      title: 'Renamed',
      startTime: '2026-10-12T17:00:00.000Z',
      endTime: '2026-10-12T17:30:00.000Z',
    })

    expect(ref.existed).toBe(true)
    expect(ref.remoteId).toBe('ses_mock_0001')
  })
})

describe('extractErrorCode', () => {
  it('reads a numeric code from a JSON body', () => {
    expect(extractErrorCode(`{"code":${String(DUPLICATE_EMAIL_CODE)}}`)).toBe(DUPLICATE_EMAIL_CODE)
  })

  it('reads a string-encoded code, because APIs are inconsistent about this', () => {
    expect(extractErrorCode(`{"errorCode":"${String(DUPLICATE_EMAIL_CODE)}"}`)).toBe(
      DUPLICATE_EMAIL_CODE,
    )
  })

  it('falls back to a substring match on a plain-text body', () => {
    // Recognising the failure matters more than the body being well formed: the
    // whole point is deciding between "fail" and "look it up instead".
    expect(extractErrorCode(`error ${String(DUPLICATE_EMAIL_CODE)}: duplicate`)).toBe(
      DUPLICATE_EMAIL_CODE,
    )
  })

  it('extracts any code, leaving the duplicate comparison to the caller', () => {
    // Deliberately not a duplicate-only detector: the status mapping needs the
    // real code so an unrelated failure keeps its own error id.
    expect(extractErrorCode('{"code":4000}')).toBe(4000)
  })

  it('returns undefined when there is no code at all', () => {
    expect(extractErrorCode('{"message":"nope"}')).toBeUndefined()
  })

  it('does not throw on a body that is not JSON at all', () => {
    expect(extractErrorCode('<html>502 Bad Gateway</html>')).toBeUndefined()
  })
})
