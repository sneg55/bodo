'use client'

// The browser side of /api/files/upload.
//
// The file is PUT as the raw request body, not as multipart FormData, because the route
// streams it straight into `bucket.put(key, request.body)` and a multipart wrapper would
// have to be parsed, which means buffered. `Content-Length` is what the route validates
// the size against before writing the first byte, and the browser sets it from the Blob.
//
// Errors come back as JSON from the route's own AppError handler, so the message shown
// to the speaker is the one the server wrote (the cap that was exceeded, the type that
// was rejected, or the missing R2 binding) rather than a generic failure.

export type UploadKind = 'headshot' | 'image' | 'slides' | 'doc'

/**
 * Which upload kind a chosen file belongs to.
 *
 * A Tasks row says `kind: 'upload'` and nothing about what sort of file it wants, so the
 * caps and accepted types have to come from the file itself. The two private kinds accept
 * different lists (`slides` takes pdf/ppt/pptx/key, `doc` takes pdf/doc/docx), and picking
 * one blindly would reject a real deck on a task that plainly asked for slides.
 */
export function uploadKindFor(contentType: string): UploadKind {
  // An IMAGE is a legitimate answer to a file request and used to be an impossible one. A
  // request titled "Upload Final Headshot (print quality)" classified a PNG as `doc`, whose
  // accepted types are PDF and Office documents, so it was refused after the file had been
  // chosen; the constraint line underneath said "PDF, PPT, PPTX, KEY, DOC or DOCX" beneath a
  // request asking for a photograph.
  //
  // `image` and not `headshot`: the headshot kind is public and the upload route writes its
  // URL onto the Speakers record, so answering a file request with a photo would replace the
  // speaker's profile picture whether or not that is what the request was about.
  if (IMAGE_TYPES.has(contentType)) return 'image'
  return PRESENTATION_TYPES.has(contentType) ? 'slides' : 'doc'
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const PRESENTATION_TYPES = new Set([
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-iwork-keynote-sffkey',
])

export type UploadOutcome =
  | { ok: true; objectKey: string; visibility: 'public' | 'private'; fileId: string }
  | { ok: false; message: string }

/**
 * `code` attaches the upload to one of the caller's own submissions, by its `SESS-<n>`
 * code rather than a record id, so the route never has to trust an id from the browser.
 *
 * `fileRequestId` answers a File Request. It IS a record id, and that is safe for the reason
 * the route documents: it is looked up in a list of the caller's own assignments, so an id
 * that is not theirs resolves to nothing and the upload is refused before any bytes move.
 */
export async function uploadFile(input: {
  file: File
  kind: UploadKind
  code?: string
  fileRequestId?: string
}): Promise<UploadOutcome> {
  const { file, kind, code, fileRequestId } = input
  const query = new URLSearchParams({ kind, filename: file.name })
  if (code !== undefined && code !== '') query.set('code', code)
  if (fileRequestId !== undefined && fileRequestId !== '') {
    query.set('fileRequestId', fileRequestId)
  }

  try {
    const response = await fetch(`/api/files/upload?${query.toString()}`, {
      method: 'POST',
      headers: { 'content-type': file.type },
      body: file,
    })
    const payload: unknown = await response.json()
    if (!response.ok) return { ok: false, message: messageFrom(payload, response.status) }
    return readStored(payload)
  } catch {
    // A network failure, or a body the route did not answer with JSON. Either way the
    // file is not stored, and saying so is more useful than the underlying text.
    return { ok: false, message: 'The upload did not complete. Check your connection.' }
  }
}

function readStored(payload: unknown): UploadOutcome {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, message: 'The upload response could not be read.' }
  }
  const record = payload as Record<string, unknown>
  const objectKey = typeof record.objectKey === 'string' ? record.objectKey : ''
  if (objectKey === '') return { ok: false, message: 'The upload response carried no object key.' }

  // A missing `fileId` is treated as a failure rather than defaulted, because the route
  // now writes the Files row before it answers. A 201 without one means the object is in
  // R2 with nothing tracking it, and reporting that as success is how a speaker ends up
  // believing a file was attached when nothing can ever read it.
  const fileId = typeof record.fileId === 'string' ? record.fileId : ''
  if (fileId === '') {
    return { ok: false, message: 'The file was stored but not recorded. Tell the organizer.' }
  }

  return {
    ok: true,
    objectKey,
    visibility: record.visibility === 'public' ? 'public' : 'private',
    fileId,
  }
}

function messageFrom(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null) {
    const error = (payload as Record<string, unknown>).error
    if (typeof error === 'string' && error !== '') return error
  }
  return `The upload was refused (${String(status)}).`
}
