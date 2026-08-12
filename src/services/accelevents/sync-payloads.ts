// Local records to Accelevents payloads. Pure, and the only place the field mapping lives.
//
// Separate from sync.ts, which owns the walk (what order, what is claimed, what is
// logged), for the reason accelevents-remote.ts is separate from the retry sweep: these
// two change for different reasons. The walk changes when the retry or claim policy
// does; this changes when their DTOs do, and their DTOs are the half bodo does not
// control.
//
// Two builders return `undefined` instead of a payload, and that is the mechanism by
// which an entity is held back rather than pushed wrong. There is no partial push here:
// a payload is either complete enough to send or the entity is skipped and stays a
// visible gap, because the far side is a registration platform whose rows an attendee
// sees.
//
// UNVERIFIED against the live API, and worth stating where the mapping is written
// (§5.7 says the mock proves none of it): whether `description` is accepted as HTML,
// which fields a session create really requires, and whether `format` must name a value
// that already exists on their side. The first live run is where those get settled.

import { MANUAL_DESCRIPTION_KEY } from '@/features/review/abstracts-rows'
import type { SessionPayload, SpeakerPayload, TaxonomyPayload } from '@/services/accelevents/client'
import type { Speaker, Submission } from '@/types/domain'
import type { Form } from '@/types/forms'

/**
 * A speaker, or nothing when they have no address.
 *
 * The email is not one field among six: it is the identity Accelevents dedupes on, and
 * the whole duplicate-email branch in §5.7 is a lookup BY it. Pushing an empty address
 * would either create an unreachable remote speaker or collide every such speaker onto
 * one record.
 *
 * This is a real population rather than a defensive check. A Sessionize import creates
 * speakers with no address by design, because their public speaker object carries none
 * (`NeedsEmailRow` in src/types/imports.ts), so an event that was imported and is now
 * being pushed has exactly these rows in it.
 */
export function speakerPayload(speaker: Speaker): SpeakerPayload | undefined {
  const email = speaker.email.trim()
  if (email === '') return undefined
  return {
    firstName: speaker.firstName,
    lastName: speaker.lastName,
    email,
    ...optional('biography', speaker.bio),
    ...optional('company', speaker.company),
    ...optional('headshotUrl', speaker.headshotUrl),
  }
}

export function trackPayload(name: string): TaxonomyPayload {
  return { type: 'TRACKS', name }
}

export function tagPayload(name: string): TaxonomyPayload {
  return { type: 'TAGS', name }
}

/**
 * Everything a session payload needs that is not on the submission itself.
 *
 * The remote id lists arrive already resolved, because resolving them is the walk's job:
 * they only exist once the tracks, tags and speakers ahead of this session in the
 * dependency order have landed, and deciding what to do when one has not is a policy
 * question (sync.ts holds it back) rather than a formatting one.
 */
export type SessionContext = {
  description?: string
  roomName?: string
  trackRemoteIds: readonly string[]
  tagRemoteIds: readonly string[]
  speakerRemoteIds: readonly string[]
}

/**
 * A session, or nothing when it has no place in time yet.
 *
 * `startTime` and `endTime` are required by their API and by
 * `sessionPayloadSchema`, so an accepted-but-unscheduled submission cannot produce a
 * payload at all. It is therefore not merely unsent, it is UNLOGGABLE: a SyncLog row
 * whose `payloadJson` fails that schema makes `mapSyncLog` throw, and since the sweep
 * maps every row before it filters, one such row would abort every later retry for every
 * event. So the walk counts it and writes nothing. See `blocked` in sync.ts.
 */
export function sessionPayload(
  submission: Submission,
  context: SessionContext,
): SessionPayload | undefined {
  if (submission.startsAt === undefined || submission.endsAt === undefined) return undefined
  return {
    title: submission.title,
    startTime: submission.startsAt,
    endTime: submission.endsAt,
    ...optional('description', context.description),
    ...optional('format', submission.format),
    ...optional('room', context.roomName),
    ...list('trackIds', context.trackRemoteIds),
    ...list('tagIds', context.tagRemoteIds),
    ...list('speakerIds', context.speakerRemoteIds),
  }
}

/**
 * Where a submission's Description lives.
 *
 * Description is a registry field with `column: false`, so the answer sits in
 * `answersJson` under the FORM FIELD id, which differs per form; a manually added
 * abstract has no form and stores it under the registry key itself. The rule and this
 * lookup are `readDescription` in src/features/review/abstracts-rows.ts, which owns it
 * and exports the key but not the resolution. It is repeated rather than exported from
 * there because matching on the label instead would pick up a local question an
 * organizer happened to call "Description", and getting that wrong here writes somebody
 * else's answer into a public session listing.
 *
 * The stored value is rich text and is sent AS STORED. Stripping it to plain text is a
 * lossy transformation this code cannot reverse, and the organizer wrote the formatting
 * on purpose. If the live API rejects HTML, this is the one line that changes.
 */
export function describeSubmission(
  submission: Submission,
  forms: readonly Form[],
): string | undefined {
  const form = forms.find((entry) => entry.id === submission.formId)
  const fieldId = form?.fields.find((field) => field.registryKey === MANUAL_DESCRIPTION_KEY)?.id
  const answers = new Map(Object.entries(submission.answers))
  const raw = answers.get(fieldId ?? MANUAL_DESCRIPTION_KEY) ?? answers.get(MANUAL_DESCRIPTION_KEY)
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * An optional field, present only when it carries something.
 *
 * A key set to `undefined` is not the same as an absent key here: the payload is hashed
 * to decide whether a request has already been accepted (request-hash.ts), and
 * `canonicalJson` throws on `undefined`. Omitting is also what stops a blank local field
 * from clearing a value somebody filled in on the far side.
 */
function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? {} : ({ [key]: trimmed } as Record<K, string>)
}

/** The same rule for a list: an empty one is omitted, never sent as `[]`. */
function list<K extends string>(
  key: K,
  values: readonly string[],
): Partial<Record<K, readonly string[]>> {
  return values.length === 0 ? {} : ({ [key]: values } as Record<K, readonly string[]>)
}
