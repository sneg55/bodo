// Upload caps, accepted types, visibility, and the object key. BUILD_SPEC 5.2.
//
// Split out of uploads.ts when that file crossed the 300 line limit, and split along the seam
// that was already there: everything here is a PURE decision about what MAY be uploaded and
// where it lands, and nothing here touches R2. It is also the half the tests drive directly
// (tests/uploads.test.ts), because a cap or an accepted-type list is asserted by calling it
// rather than by uploading 40 MB.
//
// uploads.ts re-exports all of it, so every existing import site is unchanged.

import { AppError, ErrorIds } from '@/constants/errorIds'

/**
 * What may be uploaded, and it is two families rather than one list.
 *
 * `headshot`, `slides` and `doc` belong to a SPEAKER and are keyed under a speaker id.
 * `event-logo` and `event-background` belong to an EVENT and are keyed under an event id:
 * they are uploaded from Event Settings > Image Settings by an organizer, who has no
 * speaker id at all. `uploadScopeFor` is where that split is decided, and `ownerSegment`
 * is where it decides the key.
 *
 * `speaker-headshot` sits across the two and is a third kind rather than a reuse of
 * `headshot`, deliberately. The OBJECT belongs to a speaker and is keyed under their id,
 * but the CALLER is an organizer editing the roster, authorized on the event and never
 * holding a speaker session. One kind for both would mean one word standing for two
 * authorization stories, and the route branches on exactly this. Its own prefix is the
 * price: a speaker's photographs then live under two of them, which a per-speaker purge
 * has to walk rather than one, and that is cheaper than the ambiguity.
 */
export type UploadKind =
  | 'headshot'
  | 'speaker-headshot'
  | 'image'
  | 'slides'
  | 'doc'
  | 'event-logo'
  | 'event-background'

/** Which owner an upload is keyed under. See `UploadKind`. */
export type UploadScope = 'speaker' | 'event'

const SCOPE_BY_KIND = new Map<UploadKind, UploadScope>([
  ['headshot', 'speaker'],
  // Keyed under the SPEAKER whose face it is, not under the event whose admin sent it.
  // The object outlives this organizer's membership and follows the person.
  ['speaker-headshot', 'speaker'],
  ['slides', 'speaker'],
  ['doc', 'speaker'],
  // A photo answering a FILE REQUEST. Speaker-scoped like their other uploads, and
  // deliberately NOT `headshot`: the upload route writes a headshot's URL onto the Speakers
  // record, so a photo sent to satisfy a request would silently replace the profile picture.
  // This entry was the missing half of that decision, and its absence made `uploadScopeFor`
  // throw for the one kind `uploadKindFor` hands out most.
  ['image', 'speaker'],
  ['event-logo', 'event'],
  ['event-background', 'event'],
])

export function uploadScopeFor(kind: UploadKind): UploadScope {
  const scope = SCOPE_BY_KIND.get(kind)
  if (scope === undefined) {
    throw new AppError(ErrorIds.FILE_TYPE_REJECTED, `unknown upload kind ${kind}`, { kind })
  }
  return scope
}

/**
 * The raster image types. Shared by the headshot and the two event images so the three
 * cannot drift, and SVG is deliberately absent from it: these objects are served from a
 * public bucket, and an SVG is a script container, so accepting one would publish
 * arbitrary script under the deployment's own file domain.
 */
const IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']

/**
 * Caps are set by the platform, not by preference. A request body proxied through
 * a Worker is bounded by Cloudflare's limit (100 MB on Free and Pro), so a
 * nominal 100 MB cap would have no headroom for overhead. 25 MB for documents is
 * comfortably inside it and still covers a real slide deck. If a bigger file ever
 * matters, that is the point at which presigned upload earns its complexity, and
 * it is a contained change because callers only ever see `objectKey`.
 */
export type UploadLimit = { maxBytes: number; types: readonly string[] }

// A Map rather than a Record: the security lint treats any computed read on a
// plain object as an injection sink, even when the key is a union type.
const UPLOAD_LIMITS = new Map<UploadKind, UploadLimit>([
  ['headshot', { maxBytes: 10 * 1024 * 1024, types: IMAGE_TYPES }],
  // The same photograph through a different door, so the same cap and the same types. A
  // tighter cap here would refuse an organizer the file the speaker could have sent
  // themselves, which is a rule nobody could explain.
  ['speaker-headshot', { maxBytes: 10 * 1024 * 1024, types: IMAGE_TYPES }],
  // A photograph delivered against a FILE REQUEST, which is not the same thing as a
  // headshot even when the request asks for one. `headshot` is public and the upload route
  // writes its URL onto the Speakers record; a print-quality photo answering a request must
  // not silently replace somebody's profile picture, and a photo of a demo rig certainly
  // must not. Same types and same cap, private, and no write anywhere but Files.
  ['image', { maxBytes: 10 * 1024 * 1024, types: IMAGE_TYPES }],
  // The two event images. A 300 x 300 logo has no business being large, so its cap is the
  // tighter of the two; the background is a 1500 x 500 banner and gets the headshot's cap.
  // Both are validated before the first byte is written, like every other kind.
  ['event-logo', { maxBytes: 5 * 1024 * 1024, types: IMAGE_TYPES }],
  ['event-background', { maxBytes: 10 * 1024 * 1024, types: IMAGE_TYPES }],
  [
    'slides',
    {
      maxBytes: 25 * 1024 * 1024,
      types: [
        'application/pdf',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/x-iwork-keynote-sffkey',
      ],
    },
  ],
  [
    'doc',
    {
      maxBytes: 25 * 1024 * 1024,
      types: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    },
  ],
])

export function uploadLimit(kind: UploadKind): UploadLimit {
  const limit = UPLOAD_LIMITS.get(kind)
  if (limit === undefined) {
    throw new AppError(ErrorIds.FILE_TYPE_REJECTED, `unknown upload kind ${kind}`, { kind })
  }
  return limit
}

/**
 * Headshots are public; anything a speaker was asked to submit privately is not.
 *
 * Both event images are public and that is not an oversight: a logo is rendered by the
 * public agenda page and a background by the portal, so a private one would need an
 * authenticated serving route that no anonymous visitor could use.
 */
const VISIBILITY_BY_KIND = new Map<UploadKind, 'public' | 'private'>([
  ['headshot', 'public'],
  // Public for the reason `headshot` is: it lands on `Speakers.headshotUrl`, which the
  // public agenda and the speaker gallery both render for anonymous visitors.
  ['speaker-headshot', 'public'],
  ['image', 'private'],
  ['slides', 'private'],
  ['doc', 'private'],
  ['event-logo', 'public'],
  ['event-background', 'public'],
])

export function visibilityFor(kind: UploadKind): 'public' | 'private' {
  // Default to private: a new upload kind added without thinking about exposure
  // should fail closed, not publish itself.
  return VISIBILITY_BY_KIND.get(kind) ?? 'private'
}

export type UploadRequest = {
  kind: UploadKind
  /**
   * The owner of a speaker-scoped upload, resolved by `requireSpeaker()` and never read
   * off the request. Absent for an event-scoped kind, which has no speaker.
   */
  speakerId?: string
  /**
   * The owner of an event-scoped upload: the event id `requireEventRole(eventId, 'admin')`
   * has just authorized. Same property as `speakerId` and for the same reason, so a caller
   * cannot write into an event's prefix by naming it.
   */
  eventId?: string
  submissionId?: string
  filename: string
  contentType: string
  /** From Content-Length. Checked before the first byte is written. */
  declaredBytes: number
  body: ReadableStream
}

export type StoredObject = {
  objectKey: string
  visibility: 'public' | 'private'
  contentType: string
  size: number
}

/**
 * Validate before touching the network. Rejecting a 40 MB upload after streaming
 * it costs the speaker their whole wait and the Worker its whole CPU budget, so
 * the declared size and type are checked first and the stored size is verified
 * afterwards. Both checks are necessary: the first is cheap and the second is true.
 */
export function checkUploadAllowed(
  kind: UploadKind,
  contentType: string,
  declaredBytes: number,
): void {
  const limit = uploadLimit(kind)

  if (!limit.types.includes(contentType)) {
    throw new AppError(ErrorIds.FILE_TYPE_REJECTED, `${contentType} is not accepted for ${kind}`, {
      kind,
      contentType,
      accepted: limit.types,
    })
  }

  // Content-Length is a claim made by the client, so the lower bound matters as
  // much as the upper one. Only the cap used to be checked, and 0, -1, and 1.5 are
  // not above it while `NaN > cap` is simply false, so all four reached the write
  // and then made the post-write size comparison meaningless.
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes <= 0) {
    throw new AppError(
      ErrorIds.FILE_UPLOAD_FAIL,
      `declared size ${String(declaredBytes)} is not a positive whole number of bytes`,
      { kind, declaredBytes },
    )
  }

  if (declaredBytes > limit.maxBytes) {
    throw new AppError(
      ErrorIds.FILE_TOO_LARGE,
      `${kind} uploads are capped at ${limitLabel(limit.maxBytes)}`,
      {
        kind,
        declaredBytes,
        maxBytes: limit.maxBytes,
      },
    )
  }
}

/**
 * Keys are prefixed by kind and owner so a bucket listing is navigable and a
 * per-speaker purge is a prefix delete. The random suffix means re-uploading the
 * same filename never overwrites the previous file, which matters because a Files
 * row already points at the old key.
 */
export function buildObjectKey(
  request: Pick<UploadRequest, 'kind' | 'speakerId' | 'eventId' | 'filename'>,
  nonce: string,
): string {
  const safeName = sanitizeFilename(request.filename)
  return `${request.kind}/${ownerSegment(request)}/${nonce}-${safeName}`
}

/**
 * The owner prefix, chosen by the kind's scope and never by which field happens to be set.
 *
 * Two things this refuses to do, both of which would be a hole rather than a bug. It does
 * not fall back to the other family's id, so an organizer's event logo can never land under
 * a speaker prefix the portal serves. And it does not accept a missing or blank id, because
 * an empty segment collapses every unowned upload into one prefix that nobody owns and no
 * per-owner purge can reach.
 */
function ownerSegment(request: Pick<UploadRequest, 'kind' | 'speakerId' | 'eventId'>): string {
  const scope = uploadScopeFor(request.kind)
  const owner = (scope === 'event' ? request.eventId : request.speakerId)?.trim() ?? ''
  if (owner === '') {
    throw new AppError(
      ErrorIds.FILE_UPLOAD_FAIL,
      `a ${request.kind} upload needs a resolved ${scope} id to key on`,
      { kind: request.kind, scope },
    )
  }
  return owner
}

/**
 * Filenames arrive from a browser and end up in an object key. Path separators,
 * leading dots, and control characters are removed rather than escaped, because
 * the readable name is a convenience and the nonce is what makes the key unique.
 */
function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^[.\-]+/, '')
    .slice(0, 100)
  return cleaned === '' ? 'file' : cleaned
}

function limitLabel(bytes: number): string {
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`
}
