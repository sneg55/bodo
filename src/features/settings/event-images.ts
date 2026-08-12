// The two event image slots, as a decision the route, the write and the picker all share.
//
// Event Settings > Image Settings (docs/parity/event-config.md ref 04) has a Logo Image and
// a Background Image. Everything about them that is a pure decision lives here, so the same
// answer is used in three places that would otherwise each have their own copy:
//
//   1. `/api/files/upload` uses `eventImageKindOf` to decide it is on the ORGANIZER branch
//      rather than the speaker one, before it authorizes anything.
//   2. The write uses `eventImageField` to pick which Events column the stored URL lands on.
//   3. The client picker uses `EVENT_IMAGE_ACCEPT`, which a test pins to the server's own
//      accepted-type list so the dialog cannot offer a file the route will refuse.
//
// Nothing here imports the storage service or the DAL at runtime, so it is safe to import
// from a client component. `UploadKind` comes in as a type only, which is what keeps these
// two literals from drifting from the kinds the R2 layer knows about.

import type { UploadKind } from '@/services/storage/upload-limits'

export type EventImageKind = 'event-logo' | 'event-background'

export const EVENT_IMAGE_KINDS = [
  'event-logo',
  'event-background',
] as const satisfies readonly UploadKind[]

/** Which Events column an image of this kind is stored on. */
export type EventImageField = 'logoUrl' | 'backgroundUrl'

/**
 * The kind named by a request, or undefined when it named something else.
 *
 * Undefined rather than a throw, because the caller is the upload route deciding WHICH
 * branch it is on: `headshot` is not an error there, it is the other branch. The route's own
 * `readKind` still refuses anything that is neither.
 */
export function eventImageKindOf(value: string | null | undefined): EventImageKind | undefined {
  const trimmed = value?.trim()
  return EVENT_IMAGE_KINDS.find((kind) => kind === trimmed)
}

/**
 * Mapped through a switch rather than a lookup keyed on the kind, because the result is a
 * column name and `security/detect-object-injection` is right to treat a computed read that
 * produces one as a sink.
 */
export function eventImageField(kind: EventImageKind): EventImageField {
  return kind === 'event-logo' ? 'logoUrl' : 'backgroundUrl'
}

/**
 * The `accept` attribute for the file dialog. It is the client-side convenience half of the
 * server's accepted-type list, and tests/settings-event-image.test.ts asserts the two are
 * the same list: if they diverge, an organizer picks a file the browser offered and gets a
 * 415 back with no visible reason.
 */
export const EVENT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'
