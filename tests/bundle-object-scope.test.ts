// The event-scope check, tested as the security control it is.
//
// "A download route that leaks another event's files is the worst outcome here", so this is
// the one function in the feature where a passing test is not enough: the negative cases are
// the point. Every rejection below is something a real URL could ask for.
//
// It leans on `buildObjectKey` writing the owner into the key
// (`<kind>/<speakerId>/<nonce>-<name>`, services/storage/upload-limits), so the parse has to
// stay in step with that shape. The first test pins the shape itself.

import { describe, expect, it } from 'vitest'

import { assertKeysInEventScope, objectKeyOwner } from '@/features/bundle/object-scope'
import { buildObjectKey } from '@/services/storage/upload-limits'

const OURS = 'rec-speaker-ours'
const THEIRS = 'rec-speaker-theirs'

const key = (speakerId: string, kind: 'headshot' | 'slides' | 'doc' = 'slides'): string =>
  buildObjectKey({ kind, speakerId, filename: 'deck.pdf' }, 'nonce-1234')

describe('objectKeyOwner', () => {
  it('reads the owner out of a key buildObjectKey actually produced', () => {
    expect(objectKeyOwner(key(OURS))).toEqual({ kind: 'slides', speakerId: OURS })
  })

  it('reads every speaker-owned kind', () => {
    expect(objectKeyOwner(key(OURS, 'headshot'))?.kind).toBe('headshot')
    expect(objectKeyOwner(key(OURS, 'doc'))?.kind).toBe('doc')
  })

  it('refuses an event-scoped kind, which no session bundle can contain', () => {
    expect(objectKeyOwner('event-logo/rec-event-1/nonce-logo.png')).toBeUndefined()
  })

  it('refuses a key with the wrong number of segments', () => {
    expect(objectKeyOwner('slides/rec-speaker-ours')).toBeUndefined()
    expect(objectKeyOwner('slides/rec-speaker-ours/sub/deck.pdf')).toBeUndefined()
    expect(objectKeyOwner('deck.pdf')).toBeUndefined()
  })

  it('refuses a leading slash, which would read as an empty kind', () => {
    expect(objectKeyOwner('/rec-speaker-ours/deck.pdf')).toBeUndefined()
  })

  it('refuses an empty owner segment', () => {
    expect(objectKeyOwner('slides//deck.pdf')).toBeUndefined()
  })

  it('refuses an empty name segment', () => {
    expect(objectKeyOwner('slides/rec-speaker-ours/')).toBeUndefined()
  })

  it('refuses a traversal dressed as an owner', () => {
    expect(objectKeyOwner('slides/../deck.pdf')).toBeUndefined()
    expect(objectKeyOwner('slides/rec-speaker-ours/../../secret')).toBeUndefined()
  })

  it('refuses an empty string rather than returning a blank owner', () => {
    expect(objectKeyOwner('')).toBeUndefined()
  })
})

describe('assertKeysInEventScope', () => {
  it('passes every key owned by a speaker on the event', () => {
    expect(() =>
      assertKeysInEventScope({
        objects: [
          { objectKey: key(OURS), speakerId: OURS },
          { objectKey: key(OURS, 'headshot'), speakerId: OURS },
        ],
        allowedSpeakerIds: [OURS, THEIRS],
        eventId: 'rec-event-1',
      }),
    ).not.toThrow()
  })

  it('refuses a key owned by a speaker who is not on this event', () => {
    expect(() =>
      assertKeysInEventScope({
        objects: [{ objectKey: key(THEIRS), speakerId: THEIRS }],
        allowedSpeakerIds: [OURS],
        eventId: 'rec-event-1',
      }),
    ).toThrow(/this event does not own/)
  })

  it('refuses the WHOLE archive when one member is foreign, not just that member', () => {
    let thrown: unknown
    try {
      assertKeysInEventScope({
        objects: [
          { objectKey: key(OURS), speakerId: OURS },
          { objectKey: key(THEIRS), speakerId: THEIRS },
        ],
        allowedSpeakerIds: [OURS],
        eventId: 'rec-event-1',
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('nothing was sent')
  })

  it('refuses a malformed key even when the roster is empty of nothing in particular', () => {
    expect(() =>
      assertKeysInEventScope({
        objects: [{ objectKey: 'not-a-key', speakerId: OURS }],
        allowedSpeakerIds: [OURS],
        eventId: 'rec-event-1',
      }),
    ).toThrow()
  })

  it('refuses everything when the event has no speakers at all', () => {
    expect(() =>
      assertKeysInEventScope({
        objects: [{ objectKey: key(OURS), speakerId: OURS }],
        allowedSpeakerIds: [],
        eventId: 'rec-event-1',
      }),
    ).toThrow()
  })

  it('passes trivially for no objects, which the archive builder refuses separately', () => {
    expect(() =>
      assertKeysInEventScope({ objects: [], allowedSpeakerIds: [], eventId: 'rec-event-1' }),
    ).not.toThrow()
  })

  it('names the offending keys, and only a handful of them, in the error context', () => {
    const foreign = Array.from({ length: 9 }, (_u, at) => ({
      objectKey: key(`spk-${String(at)}`),
      speakerId: `spk-${String(at)}`,
    }))
    let thrown: unknown
    try {
      assertKeysInEventScope({
        objects: foreign,
        allowedSpeakerIds: [OURS],
        eventId: 'rec-event-1',
      })
    } catch (error) {
      thrown = error
    }

    const context = (thrown as { context?: { rejected?: string[]; rejectedCount?: number } })
      .context
    expect(context?.rejectedCount).toBe(9)
    expect(context?.rejected).toHaveLength(5)
  })
})

describe('the key must belong to the row that points at it', () => {
  // The check used to ask only "is this key owned by SOME speaker on the event", so a `Files`
  // row claiming speaker A while pointing at speaker B's key passed whenever B was also on the
  // event. Object keys carry no event id, so a speaker who appears at two of an organizer's
  // conferences has one key namespace across both, and a retargeted submission link was enough
  // to pull their file from the other event into this bundle. Found by Codex review.
  it('refuses a row whose speaker and key disagree, even when both are on the event', () => {
    expect(() =>
      assertKeysInEventScope({
        objects: [{ objectKey: key(THEIRS), speakerId: OURS }],
        // BOTH speakers are on this event, which is exactly the case the roster check passes.
        allowedSpeakerIds: [OURS, THEIRS],
        eventId: 'rec-event-1',
      }),
    ).toThrow(/this event does not own/)
  })

  it('passes when they agree', () => {
    expect(() =>
      assertKeysInEventScope({
        objects: [{ objectKey: key(THEIRS), speakerId: THEIRS }],
        allowedSpeakerIds: [OURS, THEIRS],
        eventId: 'rec-event-1',
      }),
    ).not.toThrow()
  })

  it('still refuses a row whose speaker matches its key but is off the event', () => {
    // The two conditions are independent: agreeing with a key is not membership.
    expect(() =>
      assertKeysInEventScope({
        objects: [{ objectKey: key(THEIRS), speakerId: THEIRS }],
        allowedSpeakerIds: [OURS],
        eventId: 'rec-event-1',
      }),
    ).toThrow(/this event does not own/)
  })
})
