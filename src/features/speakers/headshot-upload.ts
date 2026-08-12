// The organizer branch of POST /api/files/upload for a SPEAKER's headshot. CNT-10.
//
// It exists because neither existing branch can express this. `requireSpeaker()` is right
// for a speaker uploading their own face and wrong for an organizer uploading somebody
// else's: an organizer has no speaker session at all, and the speaker branch writes
// `headshotUrl` on the speaker OF THE SESSION, so pointing it at another record would make
// it a way to write to any speaker row by id. `uploadEventImage` is the same shape as this
// and cannot be reused either, because its object belongs to an event and this one belongs
// to a person. So this is the third branch, and it is a module rather than more of route.ts
// because the route is at its size limit and this is where the authorization story lives.
//
// Five properties, in the order they happen. The first two are the whole point:
//
//   1. **`requireEventRole(eventId, 'admin')` FIRST**, before a byte is stored. It refuses a
//      speaker session and an impersonated speaker session (neither is a `user` subject at
//      all), a reviewer on this very event, and an admin of some other event. Capability
//      comes from EventMemberships on this request, never from the session cookie
//      (src/features/auth/guards.ts).
//   2. **The speaker id is RESOLVED against the authorized event's own roster**, never
//      trusted. It arrives as client input on the query string, so an admin of event A who
//      posts the record id of a speaker who is only on event B must be refused: without
//      this the branch would be a way to overwrite any speaker's photograph in the base by
//      knowing their id. Answered as not-found rather than as forbidden so the id cannot be
//      probed for existence. This is the same resolution `saveSpeakerProfileAction` does for
//      the same input, shared through `resolveEventSpeaker` so the two cannot diverge.
//   3. **`putObject` streams and then verifies.** It validates the declared type and size
//      before the first byte, wraps the body in a `FixedLengthStream` so R2 accepts a
//      re-wrapped request body, and HEADs the object afterwards. Nothing here buffers the
//      file and nothing here is a Server Action, because an action receives the body
//      already buffered into FormData.
//   4. **`Speakers.headshotUrl` is written last**, so the record never names bytes that are
//      not there, and it goes through `saveSpeakerProfile`, the same writer the portal and
//      the roster's own edit sheet use. That is what expires `speaker:{id}`, every
//      `event:{id}:speakers` the person is linked to, and the submissions lists that carry
//      the resolved cast. A second writer here would be a second chance to forget one.
//   5. **No `Files` row**, and that is a schema fact rather than an omission, exactly as it
//      is for an event image: `Files.kind` is a single select over headshot/slides/doc
//      (migrations/tables-portal.ts), so a row for this kind would be a 422. The record of
//      the image is `Speakers.headshotUrl`, which is where every reader of an avatar looks.

import { requireEventRole } from '@/features/auth/wiring'
import { SPEAKER_HEADSHOT_KIND } from '@/features/speakers/headshot-kind'
import { resolveEventSpeaker } from '@/features/speakers/resolve-speaker'
import { saveSpeakerProfile } from '@/services/airtable/mutations-speakers'
import { publicUrlFor, putObject } from '@/services/storage/uploads'
import type { RecordId } from '@/types/domain'

// Re-exported so the route imports the branch and the word that selects it from one place.
// The literal itself lives in `headshot-kind.ts`, which the BROWSER helper also imports and
// which must therefore stay clear of everything above.
export { SPEAKER_HEADSHOT_KIND }

export type SpeakerHeadshotUpload = {
  /** The event the caller claims to administer. Authorized here, then scopes the speaker. */
  eventId: string
  /** Client input. Resolved against the authorized event's roster; see property 2. */
  speakerId: string
  filename: string
  /** From the request's Content-Type. Checked against the kind's list before the write. */
  contentType: string
  /** From Content-Length. A claim by the client, verified against the stored object. */
  declaredBytes: number
  body: ReadableStream
}

export type StoredSpeakerHeadshot = {
  objectKey: string
  /** Derived from R2_PUBLIC_BASE_URL at write time; this is what the Speakers row holds. */
  url: string
  speakerId: RecordId
  size: number
  contentType: string
  visibility: 'public' | 'private'
}

export async function uploadSpeakerHeadshot(
  input: SpeakerHeadshotUpload,
): Promise<StoredSpeakerHeadshot> {
  // Authorization, on the request, before anything else. Not in a layout: this is reachable
  // by POST without the roster ever rendering (BUILD_SPEC section 4).
  await requireEventRole(input.eventId, 'admin')

  // And then the OTHER half of the question. Holding `admin` on an event says nothing about
  // whether this speaker is on it, and refusing after the upload would leave an orphan
  // object in R2 on every refused attempt with nothing to collect it.
  const speaker = await resolveEventSpeaker(input.eventId, input.speakerId)

  const stored = await putObject(
    {
      kind: SPEAKER_HEADSHOT_KIND,
      // The RESOLVED id, which is the whole point of the line above. Nothing about the key
      // comes from the request beyond the filename, which `buildObjectKey` sanitises.
      speakerId: speaker.id,
      filename: input.filename,
      contentType: input.contentType,
      declaredBytes: input.declaredBytes,
      body: input.body,
    },
    crypto.randomUUID(),
  )

  // Raises CFG_ENV_MISSING when R2_PUBLIC_BASE_URL is unset, which the route answers as 503.
  // Deliberately not softened: a headshot whose URL cannot be built is not saved, and saying
  // so beats storing the bytes and leaving the column pointing at nothing.
  const url = publicUrlFor(stored.objectKey, stored.visibility)

  await saveSpeakerProfile(
    {
      eventId: input.eventId,
      speakerId: speaker.id,
      // The address is the identity every other row links on, and it is the stored one
      // rather than anything posted: `speakerFields` is compact, so this write touches the
      // headshot and leaves every other column, including the name and the bio, alone.
      draft: { email: speaker.email, headshotUrl: url },
    },
    'route',
  )

  return { ...stored, url, speakerId: speaker.id }
}
