// What the two admin Files lists read.
//
// Three cached, tagged DAL calls, issued together because none depends on another's
// result: the event (for its timezone), its speaker roster, its submissions. The files
// read needs the roster, so it is the one call that waits, and it waits on a cached read.
//
// EVENT SCOPE is the roster. The Files table has no event link, so `listFilesForEventSpeakers`
// filters on the ids this function passes it and on nothing else. Passing a wider set would
// widen the list past the event, which is why the ids come from `listSpeakers(eventId)` here
// rather than from anything a request carries.

import { fileCommentThreads } from '@/features/files/comment-threads'
import { buildFileRows, type FileRow, type FileScope } from '@/features/files/file-rows'
import { dateText, dateTimeText } from '@/features/review/date-text'
import { type FileComment, listFileComments } from '@/services/airtable/file-comments'
import {
  getEvent,
  listFilesForEventSpeakers,
  listSpeakers,
  listSubmissions,
} from '@/services/airtable/queries'
import { publicUrlFor } from '@/services/storage/uploads'
import type { RecordId } from '@/types/domain'

/**
 * A comment with its timestamp already rendered.
 *
 * Formatted on the SERVER in the event's zone, like `uploadedText` beside it: the table is
 * a client component, so a formatter cannot cross to it as a prop, and formatting in the
 * browser would make the server and the client disagree whenever their zones differ.
 */
export type FileCommentRow = Omit<FileComment, 'eventId' | 'fileId'> & {
  readonly atText: string
  /** Which upload it was written about, so a note on v1 still says so. */
  readonly onVersion: number
}

/** A row plus the link, if there is an honest one, and its comment thread. */
export type FileListRow = FileRow & {
  /** Absent for a private object, or when no public base URL is configured. */
  readonly href?: string
  /**
   * The whole deliverable's thread, oldest first, so it reads forwards: the request before
   * the answer. Every row in a version group carries the SAME thread, per comment-threads.ts:
   * a note asking for a corrected deck is answered by v2 arriving, and it used to disappear
   * from the screen at exactly that moment.
   */
  readonly comments: readonly FileCommentRow[]
}

export type FilesView = {
  readonly rows: readonly FileListRow[]
  /** Both counts, so each list can say what the other one holds instead of hiding it. */
  readonly totals: { readonly submissions: number; readonly portal: number }
}

export async function loadEventFiles(eventId: RecordId, scope: FileScope): Promise<FilesView> {
  const [event, speakers, submissions] = await Promise.all([
    getEvent(eventId),
    listSpeakers(eventId),
    listSubmissions(eventId),
  ])

  const [files, comments] = await Promise.all([
    listFilesForEventSpeakers(
      eventId,
      speakers.map((speaker) => speaker.id),
    ),
    // One call for the whole event rather than one per row, which is the fan-out
    // BUILD_SPEC 3.1 rules out. See `listFileComments` on why the tag is event-scoped.
    listFileComments(eventId),
  ])

  const lookups = {
    speakers,
    submissions,
    // Date AND TIME. It was the date alone, and that made the version history unreadable at
    // exactly the moment it matters: a speaker correcting a deck re-uploads the same
    // afternoon, so both rows read `Aug 9, 2026` and nothing on the screen could order them.
    // The rows are sorted on the raw ISO, so this only ever affected what a person could
    // verify, which is the part that counts on a column an organizer uses to decide which
    // file is current.
    formatDate: (iso: string) => dateTimeText(iso, event.timezone),
  }

  // The other list is built too, and only its length is used, so an empty screen can say how
  // many files sit on its sibling rather than leaving an organizer to guess where a missing
  // upload went. Building it costs no read. The two counts no longer add up to the event's
  // total, because the scopes overlap on a requested document filed against a session; each
  // number is that list's own length, which is what the sentence using it claims.
  const rows = buildFileRows(files, scope, lookups)
  const other = buildFileRows(files, scope === 'submissions' ? 'portal' : 'submissions', lookups)

  // Threaded by VERSION GROUP and not by file id. Comments are stored against the upload
  // they were written about, which is the right record to write and the wrong one to read:
  // a re-upload is a new `Files` row, so a per-file read showed the note on the superseded
  // row and an empty thread on the current one. See comment-threads.ts.
  const threads = fileCommentThreads(files, comments)

  return {
    rows: rows.map((row) => ({
      ...withHref(row, eventId),
      comments: (threads.get(row.id) ?? []).map((comment) => ({
        id: comment.id,
        body: comment.body,
        authorName: comment.authorName,
        at: comment.at,
        atText: dateText(comment.at, event.timezone),
        onVersion: comment.onVersion,
      })),
    })),
    totals: {
      submissions: scope === 'submissions' ? rows.length : other.length,
      portal: scope === 'portal' ? rows.length : other.length,
    },
  }
}

/**
 * Where the row's button points.
 *
 * A PUBLIC object links straight at the bucket, which costs the Worker nothing. A PRIVATE
 * one goes through `/api/files/<id>`, which authorizes the caller and streams the object.
 * That route is the half that was missing: a private file is what a speaker deliverable
 * is by default, and the table used to render a "Private" badge and no way to open it, so
 * an organizer could see that a deliverable had arrived and could not read it.
 *
 * The event id rides along because a Files row records a speaker and never an event, so the
 * route scopes by the event's roster instead. It is not a capability: see the route.
 */
function withHref(row: FileRow, eventId: RecordId): FileRow & { href?: string } {
  if (row.visibility === 'public') {
    const href = safePublicUrl(row.objectKey)
    return href === undefined ? row : { ...row, href }
  }
  return { ...row, href: `/api/files/${row.id}?event=${encodeURIComponent(eventId)}` }
}

/**
 * `publicUrlFor` raises when `R2_PUBLIC_BASE_URL` is unset, which is correct for an upload
 * path and wrong for a read: a missing base URL should cost this list its links, not the
 * whole page. The same wrapper the portal's submission detail keeps, for the same reason.
 */
function safePublicUrl(objectKey: string): string | undefined {
  try {
    return publicUrlFor(objectKey, 'public')
  } catch {
    return undefined
  }
}
