'use client'

// The browser side of an event image upload.
//
// Same shape as `@/features/portal/upload-client` and for the same reasons: the file is PUT
// as the raw request body rather than as multipart FormData, because the route streams it
// straight into `bucket.put` and a multipart wrapper would have to be parsed, which means
// buffered. `Content-Length` is what the route validates the declared size against before it
// writes the first byte, and the browser sets it from the File.
//
// It is a separate module from the portal's because it sends a different owner: `eventId`
// rather than a submission code. The route authorizes that event id with
// `requireEventRole(eventId, 'admin')`, so naming an event here is a request and not a grant.
//
// Errors are the server's own words. The route answers an AppError as JSON, so the organizer
// sees the cap that was exceeded, the type that was rejected, or the missing R2 binding,
// rather than "upload failed".

import type { EventImageKind } from '@/features/settings/event-images'

export type EventImageOutcome = { ok: true; url: string } | { ok: false; message: string }

export async function uploadEventImageFile(input: {
  file: File
  kind: EventImageKind
  eventId: string
}): Promise<EventImageOutcome> {
  const query = new URLSearchParams({
    kind: input.kind,
    eventId: input.eventId,
    filename: input.file.name,
  })

  try {
    const response = await fetch(`/api/files/upload?${query.toString()}`, {
      method: 'POST',
      headers: { 'content-type': input.file.type },
      body: input.file,
    })
    const payload: unknown = await response.json()
    if (!response.ok) return { ok: false, message: messageFrom(payload, response.status) }
    return readStored(payload)
  } catch {
    // A network failure, or a body the route did not answer with JSON. Either way the image
    // is not stored, and saying so is more useful than the underlying text.
    return { ok: false, message: 'The upload did not complete. Check your connection.' }
  }
}

/**
 * The URL is treated as required rather than defaulted, because the route derives it from
 * `R2_PUBLIC_BASE_URL` and writes it onto the event before answering. A 201 without one would
 * mean the bytes are in R2 with nothing pointing at them, and reporting that as success is
 * how an organizer ends up believing the logo was replaced.
 */
function readStored(payload: unknown): EventImageOutcome {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, message: 'The upload response could not be read.' }
  }
  const url = (payload as Record<string, unknown>).url
  if (typeof url !== 'string' || url === '') {
    return { ok: false, message: 'The image was stored but no address came back for it.' }
  }
  return { ok: true, url }
}

function messageFrom(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null) {
    const error = (payload as Record<string, unknown>).error
    if (typeof error === 'string' && error !== '') return error
  }
  return `The upload was refused (${String(status)}).`
}
