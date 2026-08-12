// The event-scope check on every object key before a byte of it is streamed.
//
// This is the security-critical half of the download and it is pure so that it can be
// tested exhaustively. A bundle route that streams another event's files is the worst
// outcome this feature has, and the ways to get there are not exotic: an id copied out of
// one conference's URL into another's, a speaker removed from the event between the request
// and the click, a `Files` row whose submission link was retargeted.
//
// It works because `buildObjectKey` (services/storage/upload-limits) writes the OWNER into
// the key: `<kind>/<speakerId>/<nonce>-<name>`, with the speaker id resolved by
// `requireSpeaker()` at upload time and never taken from the request. So the key itself
// says who it belongs to, and "does this event contain that speaker" is one cached read
// (`listSpeakers`) rather than a per-file lookup.
//
// It is deliberately a WHOLE-ARCHIVE refusal, not a filter. Quietly omitting a member
// produces an archive that looks complete and is not, and the organizer has no way to tell.
// A refusal names the keys and stops.

import { AppError, ErrorIds } from '@/constants/errorIds'

/** The upload kinds a speaker owns, which are the only ones a session bundle can contain. */
const SPEAKER_KINDS: readonly string[] = ['headshot', 'slides', 'doc']

export type ObjectKeyOwner = { readonly kind: string; readonly speakerId: string }

/**
 * The kind and owner an object key declares, or `undefined` when it is not the shape
 * `buildObjectKey` produces.
 *
 * Exactly three segments, none of them empty, and the kind has to be one a speaker owns.
 * Anything else is refused rather than interpreted: a key with a fourth segment, a leading
 * slash, or a `..` is not something this app wrote, and guessing at its owner is how a
 * traversal gets waved through.
 */
export function objectKeyOwner(objectKey: string): ObjectKeyOwner | undefined {
  const parts = objectKey.split('/')
  if (parts.length !== 3) return undefined

  const [kind, speakerId, name] = parts
  if (kind === '' || speakerId === '' || name === '') return undefined
  if (!SPEAKER_KINDS.includes(kind)) return undefined
  if (speakerId.includes('.') || name.startsWith('..')) return undefined

  return { kind, speakerId }
}

export type ScopedObject = {
  readonly objectKey: string
  /**
   * The speaker the `Files` ROW says owns this object, which must agree with the key.
   *
   * Carried rather than derived: the row and the key are two independent claims about the
   * same fact, and checking them against each other is the point. See the second rule below.
   */
  readonly speakerId: string
}

/**
 * Every key, or an error. TWO conditions, and the second one is not redundant.
 *
 * 1. The key's owner is on `allowedSpeakerIds`, the event's own roster read event-scoped. A
 *    key whose owner is not on it belongs to another event or to nobody.
 * 2. The key's owner is the `Files` row's OWN speaker. Without this, the check only asks
 *    whether the key belongs to SOME speaker on the event, so a row claiming speaker A while
 *    pointing at speaker B's key passes whenever B is also on the event. That is not
 *    hypothetical here: object keys carry no event id, so a speaker who appears at two of an
 *    organizer's conferences has one key namespace across both, and a retargeted submission
 *    link (which this file's header already names as a threat) is enough to pull their file
 *    from the other event into this bundle. The upload route writes the key from
 *    `requireSpeaker()` and writes the row's `speakerId` from the same value, so the two
 *    agreeing is an invariant this app maintains and a disagreement is always a hand edit.
 *    Found by Codex review.
 *
 * What this still cannot see, stated rather than implied: a row whose speaker and key AGREE
 * but whose object was uploaded against another event's session. Distinguishing that needs an
 * event id inside the object key, which `buildObjectKey` does not write and which cannot be
 * added retroactively to keys already in the bucket.
 */
export function assertKeysInEventScope(input: {
  objects: readonly ScopedObject[]
  allowedSpeakerIds: readonly string[]
  eventId: string
}): void {
  const allowed = new Set(input.allowedSpeakerIds)
  const rejected: string[] = []

  for (const object of input.objects) {
    const owner = objectKeyOwner(object.objectKey)
    if (
      owner === undefined ||
      !allowed.has(owner.speakerId) ||
      owner.speakerId !== object.speakerId
    ) {
      rejected.push(object.objectKey)
    }
  }

  if (rejected.length > 0) {
    throw new AppError(
      ErrorIds.AUTH_FORBIDDEN_ROLE,
      'the download includes files this event does not own; nothing was sent',
      { eventId: input.eventId, rejected: rejected.slice(0, 5), rejectedCount: rejected.length },
    )
  }
}
