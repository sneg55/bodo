// R2 upload and read-URL construction. See BUILD_SPEC §5.2.
//
// One upload design, not three. Bytes stream through the Worker via the R2
// binding: `bucket.put(key, request.body)`. Presigned direct-to-R2 PUTs were
// considered and rejected, because an R2 *binding* cannot mint them (presigning
// needs the S3-compatible endpoint plus an access key pair, and presigned URLs do
// not work through a custom domain), so it would mean a second credential path,
// bucket CORS, and signature code for a weekend build.
//
// Two rules the rest of the app depends on:
//
//   1. A Files row stores `objectKey`, never a baked URL. The public URL is
//      derived at read time from R2_PUBLIC_BASE_URL, so the bucket domain and the
//      access model both stay changeable. A stored URL freezes them forever.
//   2. Nothing is recorded until the bytes are confirmed. `putObject` HEADs the
//      object after writing and returns only if the stored size and type match
//      what was declared, deleting the object when they do not, so a Files row
//      can never claim bytes that were not actually stored.
//
// The caps, the accepted types, the visibility rule and the object key all live in
// ./upload-limits, which is pure. This file is the half that talks to the bucket, and it
// re-exports the other half so every existing import of `@/services/storage/uploads` is
// unchanged.

import { AppError, ErrorIds } from '@/constants/errorIds'
import {
  buildObjectKey,
  checkUploadAllowed,
  type StoredObject,
  type UploadRequest,
  uploadLimit,
  visibilityFor,
} from '@/services/storage/upload-limits'
import { type BucketLike, getUploadBucket } from '@/utils/cf'
import { getEnv } from '@/utils/env'

export {
  buildObjectKey,
  checkUploadAllowed,
  type StoredObject,
  type UploadKind,
  type UploadLimit,
  type UploadRequest,
  uploadLimit,
  visibilityFor,
} from '@/services/storage/upload-limits'

export async function putObject(request: UploadRequest, nonce: string): Promise<StoredObject> {
  checkUploadAllowed(request.kind, request.contentType, request.declaredBytes)

  const bucket = await getUploadBucket()
  const objectKey = buildObjectKey(request, nonce)

  await bucket.put(objectKey, withKnownLength(request.body, request.declaredBytes), {
    httpMetadata: { contentType: request.contentType },
  })

  // Verify rather than assume: a truncated stream, a cancelled request, and a
  // client that lied in Content-Length all end up here.
  const head = await bucket.head(objectKey)
  if (head === null) {
    throw new AppError(ErrorIds.FILE_UPLOAD_FAIL, 'object was not present after upload', {
      objectKey,
    })
  }

  const limit = uploadLimit(request.kind)
  if (head.size > limit.maxBytes) {
    // The declared size was a lie. Remove the object rather than leaving an
    // oversized orphan that no row references. Checked before the mismatch below
    // so the caller learns the useful thing: it is over the cap, not just wrong.
    await discardUnverified(bucket, objectKey)
    throw new AppError(ErrorIds.FILE_TOO_LARGE, 'stored object exceeded the cap', {
      objectKey,
      size: head.size,
      maxBytes: limit.maxBytes,
    })
  }

  // The check that makes this a verification rather than a formality. A stream
  // truncated by a dropped connection still passes "exists" and "under the cap",
  // so without this a Files row gets verifiedAt over a file nobody can open.
  if (head.size !== request.declaredBytes) {
    await discardUnverified(bucket, objectKey)
    throw new AppError(ErrorIds.FILE_UPLOAD_FAIL, 'stored size does not match the declared size', {
      objectKey,
      size: head.size,
      declaredBytes: request.declaredBytes,
    })
  }

  // The declared type was checked against the kind's list before the write, so
  // stored metadata that disagrees with it means the object is not what was
  // accepted. Absent metadata is not evidence of that, so it falls back.
  const storedType = head.httpMetadata?.contentType
  if (storedType !== undefined && storedType !== request.contentType) {
    await discardUnverified(bucket, objectKey)
    throw new AppError(ErrorIds.FILE_TYPE_REJECTED, 'stored content type is not the accepted one', {
      objectKey,
      storedType,
      contentType: request.contentType,
    })
  }

  // Residual risk, accepted: the type is still only the client's label, so
  // arbitrary bytes can be stored as image/jpeg and served publicly as a
  // headshot. Magic-byte sniffing is deliberately NOT done here, because it needs
  // the body and this path streams it straight through. The mitigation is the
  // serving route's: it must send `X-Content-Type-Options: nosniff` so a browser
  // cannot be talked into running a mislabelled object as HTML or script.
  return {
    objectKey,
    visibility: visibilityFor(request.kind),
    contentType: storedType ?? request.contentType,
    size: head.size,
  }
}

type FixedLength = { readable: ReadableStream; writable: WritableStream }

/**
 * The upload body as a stream R2 will accept.
 *
 * REAL BUG, reproduced on `cf:preview` against the live base rather than inferred: passing
 * the route's `request.body` straight to `bucket.put` failed EVERY upload with `TypeError:
 * Provided readable stream must have a known length (request/response body or readable half
 * of FixedLengthStream)`, and the route answered 500 with nothing in the bucket and no Files
 * row. R2 accepts an unsized stream only while it still IS a request body, and by the time a
 * Next route handler on `@opennextjs/cloudflare` hands one over it has been re-wrapped, so
 * workerd no longer sees a length. Nothing in the app could have caught it: the failure is a
 * `TypeError` from the binding rather than an `AppError`, so the route rethrew it as a 500
 * with no message.
 *
 * `FixedLengthStream` is the documented fix and it keeps the design intact, because it is a
 * pass-through: the bytes are piped in while R2 reads them out, so nothing is buffered and a
 * 25 MB deck still never sits in memory. The length is the one `checkUploadAllowed` has
 * already validated, and a client that then sends a different number of bytes makes the pipe
 * error, which surfaces as a failed `put` rather than as a verified row.
 *
 * Read off `globalThis` rather than referenced directly because it is a workerd global with
 * no Node equivalent and tests/uploads-put.test.ts runs this under Node. An absent global
 * falls back to the stream itself, which is both what those tests exercise and what a runtime
 * that does not need the wrapper would want.
 */
function withKnownLength(body: ReadableStream, declaredBytes: number): ReadableStream {
  const Fixed = (globalThis as { FixedLengthStream?: new (length: number) => FixedLength })
    .FixedLengthStream
  if (Fixed === undefined) return body

  const fixed = new Fixed(declaredBytes)
  // Not awaited: `put` consumes the readable half while this fills the writable half, so
  // awaiting here would deadlock. The rejection is swallowed because `put` reports the same
  // failure with the context a caller can act on, and an unhandled rejection on workerd takes
  // down the isolate rather than the request.
  void body.pipeTo(fixed.writable).catch(() => undefined)
  return fixed.readable
}

/**
 * Remove an object that failed verification. Nothing will reference the key, so
 * leaving it behind is an orphan that still bills and, in the public bucket, is
 * still readable. A failed delete is logged and swallowed rather than thrown:
 * replacing the verification error with a cleanup error would tell the caller the
 * wrong story about why their upload was rejected.
 */
async function discardUnverified(bucket: BucketLike, objectKey: string): Promise<void> {
  try {
    await bucket.delete(objectKey)
  } catch (error) {
    console.error(
      `[${ErrorIds.FILE_UPLOAD_FAIL}] could not delete unverified object ${objectKey}`,
      error,
    )
  }
}

/**
 * Public read URL for a public object. Throws for a private one rather than
 * returning a link that would 404 or, worse, work: a private slide deck must be
 * served through the authenticated route that checks the caller against the
 * owning submission.
 */
export function publicUrlFor(objectKey: string, visibility: 'public' | 'private'): string {
  if (visibility !== 'public') {
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'private objects have no public URL', {
      objectKey,
    })
  }
  const base = getEnv().R2_PUBLIC_BASE_URL
  if (base === undefined) {
    throw new AppError(ErrorIds.CFG_ENV_MISSING, 'R2_PUBLIC_BASE_URL is not configured', {
      objectKey,
    })
  }
  return `${base.replace(/\/$/, '')}/${objectKey}`
}
