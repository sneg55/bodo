// Resolving one file for download, scoped to an event the caller holds a role on.
//
// The scoping is the whole point, and it is the same shape the bundle download uses
// (`features/bundle/object-scope.ts`): a Files row records a SPEAKER and never an event, so
// there is no event id on the file to check against. What there is, is the event's speaker
// roster, and a file whose owner is not on it is not this event's file.
//
// That is why the event id travels in the URL rather than being derived from the file. It
// carries no capability: the caller must hold a role on whatever event they name, and the
// file is then looked for inside THAT event's set. Naming somebody else's event fails the
// role check; naming your own and passing a foreign file id finds nothing. A file id is
// therefore not a bearer token, which is what lets the link live in an ordinary anchor.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { listSpeakers } from '@/services/airtable/queries'
import { listFilesForEventSpeakers } from '@/services/airtable/reads-files'
import type { RecordId, StoredFile } from '@/types/domain'

/**
 * The file, if it belongs to a speaker on this event.
 *
 * Not-found and not-yours are deliberately the same answer, the same call the portal's
 * `readOwnSubmissionByCode` makes: telling a caller that a file id exists but belongs to
 * another conference is a fact about somebody else's event.
 */
export async function getEventFile(eventId: RecordId, fileId: RecordId): Promise<StoredFile> {
  const speakers = await listSpeakers(eventId)
  const files = await listFilesForEventSpeakers(
    eventId,
    speakers.map((speaker) => speaker.id),
  )

  const file = files.find((candidate) => candidate.id === fileId)
  if (file === undefined) {
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that file is not on this event', {
      eventId,
      fileId,
    })
  }
  return file
}

/**
 * A filename made safe to put in a `content-disposition` header.
 *
 * The value arrives from a file picker on somebody else's machine and lands inside a
 * quoted header parameter, so a stray double quote ends the parameter early and anything
 * after it is read as more header. A carriage return or newline is worse: it is a header
 * break, which is how a response gets split. Neither is exotic, because a filename is one
 * of the few strings a user controls end to end.
 *
 * Stripped rather than escaped, and rather than rejected. Escaping means getting the
 * quoting rules exactly right for a header nobody reads carefully, and rejecting would
 * fail a download over a character in a name the speaker cannot easily change. A file with
 * nothing printable left is served as `download`, since an empty filename parameter makes
 * some browsers save the URL's last segment, which here is a record id.
 */
export function safeFilename(filename: string): string {
  const cleaned = filename.replaceAll(/["\\\r\n]/gu, '').trim()
  return cleaned.length === 0 ? 'download' : cleaned
}
