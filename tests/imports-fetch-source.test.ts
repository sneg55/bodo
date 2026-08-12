// `fetchSource`: how a run's `sourceRef` is read, and how many requests each source costs.
//
// Both halves are here because both were wrong in a way nothing downstream could notice.
// A misparsed ref does not throw, it addresses the wrong event and comes back as a
// permissions warning; and a comment claiming six reads where the code makes five is the
// kind of thing that gets copied into a budget.

import { describe, expect, it, vi } from 'vitest'

import { fetchSource, parseAcceleventsRef } from '@/features/imports/fetch-source'
import type { SessionboardClient } from '@/services/imports/sessionboard'
import { EMPTY_IMPORT_MAPPING } from '@/types/imports'

describe('parseAcceleventsRef', () => {
  it('reads a bare https url as the url, not as an event id called "https"', () => {
    // The defect, and it is the documented form: §5.0e accepts a bare `<eventUrl>`, and
    // splitting on the FIRST colon made `https` the event id and `//host/e/example` the
    // url. Every admin read then went to an event that does not exist.
    expect(parseAcceleventsRef('https://events.accelevents.com/e/example')).toEqual({
      eventUrl: 'https://events.accelevents.com/e/example',
    })
    expect(parseAcceleventsRef('http://events.accelevents.com/e/example')).toEqual({
      eventUrl: 'http://events.accelevents.com/e/example',
    })
  })

  it('still splits an id-qualified ref, url scheme and all', () => {
    expect(parseAcceleventsRef('99:https://events.accelevents.com/e/example')).toEqual({
      eventId: '99',
      eventUrl: 'https://events.accelevents.com/e/example',
    })
    expect(parseAcceleventsRef('99:my-event')).toEqual({ eventId: '99', eventUrl: 'my-event' })
  })

  it('keeps taking a bare slug, and still refuses an empty ref', () => {
    expect(parseAcceleventsRef(' my-event ')).toEqual({ eventUrl: 'my-event' })
    expect(() => parseAcceleventsRef('   ')).toThrow()
  })
})

/** Every list the client exposes, each counting its own calls. */
function sessionboardClient(calls: string[]): SessionboardClient {
  const note = <T>(name: string, rows: readonly T[]) => {
    calls.push(name)
    return Promise.resolve(rows)
  }
  return {
    listEvents: () => note('listEvents', []),
    searchSessions: () => note('searchSessions', []),
    listSpeakers: () => note('listSpeakers', []),
    listContacts: () => note('listContacts', []),
    listSetting: (_eventId, setting) => note(`listSetting:${setting}`, []),
  }
}

describe('fetchSource, Sessionboard', () => {
  it('makes exactly five reads, which is what the function is documented to cost', async () => {
    // Pinned because the doc comment said six and the code has always made five. §5.0e's
    // own budget ("at least five paginated reads on the far side") is the five below.
    const calls: string[] = []

    await fetchSource(
      { source: 'sessionboard', sourceRef: 'us:1234', mapping: EMPTY_IMPORT_MAPPING },
      { authoredRemoteIds: new Set() },
      { sessionboard: () => sessionboardClient(calls) },
    )

    expect(calls).toEqual([
      'searchSessions',
      'listContacts',
      'listSetting:tracks',
      'listSetting:tags',
      'listSetting:rooms',
    ])
  })

  it('reads contacts rather than speakers, because contacts are the superset', async () => {
    const calls: string[] = []
    const build = vi.fn(() => sessionboardClient(calls))

    await fetchSource(
      { source: 'sessionboard', sourceRef: 'eu:1234', mapping: EMPTY_IMPORT_MAPPING },
      { authoredRemoteIds: new Set() },
      { sessionboard: build },
    )

    expect(calls).not.toContain('listSpeakers')
    // The region off the ref, so an EU token is not spent against the US host.
    expect(build).toHaveBeenCalledWith('eu')
  })
})
