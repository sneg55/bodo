// The organizer branch of POST /api/files/upload: an event logo or background image.
//
// It exists because the route's original guard could not express this. `requireSpeaker()` is
// the right guard for a headshot or a deck and the wrong one for an event logo: an organizer
// has no speaker id, so Event Settings > Image Settings had a dropzone with nothing behind
// it. This is the second branch, and it is a separate module rather than more of route.ts
// because the route is at its size limit and this is where the authorization story lives.
//
// Four properties, in the order they happen:
//
//   1. **`requireEventRole(eventId, 'admin')` FIRST**, before a byte is stored. It refuses a
//      speaker session and an impersonated speaker session (neither is a `user` subject at
//      all), a reviewer on this very event, and an admin of some other event. Capability
//      comes from EventMemberships on this request, never from the session cookie
//      (src/features/auth/guards.ts). Refusing before the write is not politeness: the
//      reverse order leaves an orphan object in R2 on every refused attempt, and nothing
//      collects those.
//   2. **The object key is derived from the RESOLVED event id.** The caller names an event
//      and the guard decides whether they hold `admin` on it, so the only prefix a caller
//      can ever write under is one they administer. Nothing about the key comes from the
//      request beyond the filename, which `buildObjectKey` sanitises. This mirrors the
//      speaker branch, where the key comes from the resolved speaker id.
//   3. **`putObject` streams and then verifies.** It validates the declared type and size
//      before the first byte, wraps the body in a `FixedLengthStream` (`withKnownLength`,
//      which is the fix for R2 rejecting a re-wrapped request body as unsized), and HEADs
//      the object afterwards, returning only when the stored size and type match what was
//      declared. Nothing here buffers the file and nothing here is a Server Action, because
//      an action receives the body already buffered into FormData.
//   4. **The Events column is written last**, so the record never names bytes that are not
//      there, and the write expires the tags the new image appears under.
//
// One thing this deliberately does NOT do: write a `Files` row. That is not an omission to
// tidy up later, it is a schema fact. `Files` links a Speaker and `mapFile` reads that link
// as REQUIRED (mapping-portal.ts), and `Files.kind` is a single select over
// headshot/slides/doc (migrations/tables-portal.ts), so a row for an event image would need
// an event link and two new options. Until that migration exists, `Events.logoUrl` and
// `Events.backgroundUrl` are the record of the image, exactly as `Speakers.headshotUrl` is
// for a headshot, and inventing a speakerless Files row would create a record that every
// existing reader of that table throws on.

import { requireEventRole } from '@/features/auth/wiring'
import {
  type EventImageField,
  type EventImageKind,
  eventImageField,
} from '@/features/settings/event-images'
import { setEventImage } from '@/services/airtable/mutations-event'
import { publicUrlFor, putObject } from '@/services/storage/uploads'

export type EventImageUpload = {
  kind: EventImageKind
  /** The event whose image is being replaced. Authorized here, then keyed on. */
  eventId: string
  filename: string
  /** From the request's Content-Type. Checked against the kind's list before the write. */
  contentType: string
  /** From Content-Length. A claim by the client, verified against the stored object. */
  declaredBytes: number
  body: ReadableStream
}

export type StoredEventImage = {
  objectKey: string
  /** Derived from R2_PUBLIC_BASE_URL at write time; this is what the Events column holds. */
  url: string
  field: EventImageField
  size: number
  contentType: string
  visibility: 'public' | 'private'
}

export async function uploadEventImage(input: EventImageUpload): Promise<StoredEventImage> {
  // Authorization, on the request, before anything else. Not in a layout: this is reachable
  // by POST without the settings tree ever rendering (BUILD_SPEC section 4).
  await requireEventRole(input.eventId, 'admin')

  const stored = await putObject(
    {
      kind: input.kind,
      // The authorized id, which is the whole point. See property 2 in the header.
      eventId: input.eventId,
      filename: input.filename,
      contentType: input.contentType,
      declaredBytes: input.declaredBytes,
      body: input.body,
    },
    crypto.randomUUID(),
  )

  // Raises CFG_ENV_MISSING when R2_PUBLIC_BASE_URL is unset, which the route answers as 503.
  // Deliberately not softened: a logo whose URL cannot be built is not saved, and saying so
  // is better than storing the bytes and leaving the column pointing at nothing.
  const url = publicUrlFor(stored.objectKey, stored.visibility)
  const field = eventImageField(input.kind)

  await setEventImage({ eventId: input.eventId, field, url }, 'route')

  return { ...stored, url, field }
}
