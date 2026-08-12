// A speaker's requested documents, flattened for the client.
//
// Same discipline task-view.ts states and for the same reason: the portal control is
// interactive (a file input and a transition), so it is a client component, and sending
// `FileRequestItem` would put the whole request record plus the whole assignment into the RSC
// payload for every row. BUILD_SPEC 6.3 scores payload discipline.
//
// The delivered filename comes from the `Files` rows the speaker already has in the payload
// (`listFilesForSpeaker`), matched on `fileRequestAssignmentId`, so a received request can say
// WHAT arrived rather than only that something did. Newest first, because a second upload
// against one request is a newer version of the same document.
//
// Pure, and tested in tests/file-requests-portal-view.test.ts.

import { dedupeRequestAssignments } from '@/features/file-requests/plan'
import { type FileVersion, fileVersions } from '@/features/files/versions'
import { submissionCardTitle } from '@/features/portal/own-submissions'
import { portalFileHref } from '@/features/portal/submission-files'
import { formatDue } from '@/features/portal/task-view'
import { dateTimeText } from '@/features/review/date-text'
import type { FileRequestItem } from '@/services/airtable/reads-requests'
import type { StoredFile, SubmissionWithParticipants } from '@/types/domain'

export type RequestUploadView = {
  assignmentId: string
  fileRequestId: string
  title: string
  /** Organizer-authored HTML from ref 31's Instructions editor. May be absent. */
  instructionsHtml?: string
  required: boolean
  dueLabel?: string
  received: boolean
  /** `SESS-3 - Why agent plans fail halfway`, for a submission-scoped request. */
  submissionLabel?: string
  /** Sent with the upload so the file is filed against the session as well. */
  submissionCode?: string
  /** The most recent file delivered against this row, when there is one. */
  deliveredFilename?: string
  /**
   * The id of that file, so the speaker can open its comment thread.
   *
   * The thread is the organizer telling them what to change, and until this was carried
   * across the portal had no way to reach it: the whole conversation lived in a popover on
   * an admin screen the person who had to act on it cannot open.
   */
  deliveredFileId?: string
  /**
   * Which version the delivered file is, and how many there are: `{ version: 2, of: 3 }`.
   *
   * The portal said "Uploading again adds a new version, and the organizer sees the newest
   * one" and then showed one filename, so a speaker who re-uploaded had no way to confirm
   * which of their files the organizer would open. The admin Files table has had this
   * column since the versions work; the speaker's own view of their own uploads did not.
   */
  deliveredVersion?: { version: number; of: number }
  /**
   * EVERY file delivered against this request, newest first, each with the version it is,
   * when it arrived and a link that opens it.
   *
   * `deliveredVersion` above says which of N the newest one is, and a count is not a
   * history: it told a speaker there were three uploads and named exactly one of them.
   * Nothing in the portal listed the other two, put a timestamp on any of them, or offered a
   * way to open one and check. The organizer's PROGRAM > Files table has had all three since
   * versions shipped, which is precisely the asymmetry this closes.
   *
   * Empty when nothing has been delivered. A single delivery still gets one entry: unlike
   * the `(version 1 of 1)` sentence, a row carrying a timestamp and a download control is
   * not noise, it is the only way to open the file at all.
   */
  deliveredVersions: readonly DeliveredVersionView[]
}

/** One delivered file, as the portal's version list renders it. */
export type DeliveredVersionView = {
  fileId: string
  filename: string
  /** 1-based within this request's version group. */
  version: number
  isLatest: boolean
  /** Date AND time, in the event's timezone: two versions routinely arrive on one day. */
  uploadedText: string
  /** The authenticated portal download route. Carries no capability; see `own-file.ts`. */
  href: string
}

export function toRequestUploadViews(input: {
  items: readonly FileRequestItem[]
  submissions: readonly SubmissionWithParticipants[]
  files: readonly StoredFile[]
  /** The event's timezone, so a due date reads the same here and admin-side. */
  timeZone: string
}): readonly RequestUploadView[] {
  const submissionById = new Map(input.submissions.map((row) => [row.id, row]))
  const newestByAssignment = newestFilePerAssignment(input.files)
  const versionsByFile = fileVersions(input.files)
  const deliveredByAssignment = filesPerAssignment(input.files, versionsByFile, input.timeZone)

  // Deduplicated first. Without it a duplicate row showed the speaker the same document
  // twice, and the admin side could read it as received off one of the two while their own
  // list still had the other outstanding.
  return dedupeRequestAssignments(input.items).map((item) => {
    const submission =
      item.assignment.submissionId === undefined
        ? undefined
        : submissionById.get(item.assignment.submissionId)

    return {
      assignmentId: item.assignment.id,
      fileRequestId: item.request.id,
      title: item.request.title,
      instructionsHtml: item.request.instructionsHtml,
      required: item.request.required,
      dueLabel: formatDue(item.request.dueAt, input.timeZone),
      received: item.assignment.status === 'received',
      submissionLabel: submission === undefined ? undefined : submissionCardTitle(submission),
      submissionCode: submission?.code,
      deliveredFilename: newestByAssignment.get(item.assignment.id)?.filename,
      deliveredFileId: newestByAssignment.get(item.assignment.id)?.id,
      deliveredVersion: versionOf(newestByAssignment.get(item.assignment.id), versionsByFile),
      deliveredVersions: deliveredByAssignment.get(item.assignment.id) ?? [],
    }
  })
}

/**
 * Every file per assignment, NEWEST FIRST, already formatted and linked.
 *
 * Newest first because that is the one the organizer opens and the one a speaker checking
 * their work wants at the top; the history reads downwards from it. The record id breaks a
 * tie within one instant, matching `fileVersions`, so the order is total and does not change
 * between reads.
 *
 * No submission code on the link. These rows come from `listFilesForSpeaker`, so they are
 * the caller's own uploads by construction, and `getOwnFile` resolves an unqualified id
 * inside exactly that set. A per-session request would also resolve through its submission,
 * but the speaker-owned path is the narrower of the two and it always applies here.
 */
function filesPerAssignment(
  files: readonly StoredFile[],
  versions: ReadonlyMap<string, FileVersion>,
  timeZone: string,
): ReadonlyMap<string, readonly DeliveredVersionView[]> {
  const byAssignment = new Map<string, DeliveredVersionView[]>()

  for (const file of files) {
    const assignmentId = file.fileRequestAssignmentId
    if (assignmentId === undefined) continue
    const found = versions.get(file.id)
    const entry: DeliveredVersionView = {
      fileId: file.id,
      filename: file.filename,
      version: found?.version ?? 1,
      isLatest: found?.isLatest ?? true,
      uploadedText: dateTimeText(file.uploadedAt, timeZone),
      href: portalFileHref(file.id),
    }
    const held = byAssignment.get(assignmentId)
    if (held === undefined) byAssignment.set(assignmentId, [entry])
    else held.push(entry)
  }

  for (const entries of byAssignment.values()) {
    entries.sort((left, right) => right.version - left.version)
  }
  return byAssignment
}

/**
 * The latest file per assignment.
 *
 * A request can legitimately hold two files: a speaker who re-uploads a corrected deck gets a
 * second `Files` row, because the first upload is a thing that happened and deleting the record
 * of it would be a lie about the object still sitting in R2. The portal shows the newest.
 */
function newestFilePerAssignment(files: readonly StoredFile[]): ReadonlyMap<string, StoredFile> {
  const newest = new Map<string, StoredFile>()

  for (const file of files) {
    const assignmentId = file.fileRequestAssignmentId
    if (assignmentId === undefined) continue
    const held = newest.get(assignmentId)
    if (held === undefined || held.uploadedAt.localeCompare(file.uploadedAt) < 0) {
      newest.set(assignmentId, file)
    }
  }

  return newest
}

/** Counts for the card header: how many are outstanding. */
export function outstandingRequests(
  views: readonly RequestUploadView[],
): readonly RequestUploadView[] {
  return views.filter((view) => !view.received)
}

/**
 * The version a delivered file is, or nothing when it is the only one.
 *
 * Omitted for a single file on purpose: "version 1 of 1" is noise on the common case, and
 * the sentence beside it already explains what a second upload would do.
 */
function versionOf(
  file: StoredFile | undefined,
  versions: ReadonlyMap<string, FileVersion>,
): { version: number; of: number } | undefined {
  if (file === undefined) return undefined
  const found = versions.get(file.id)
  if (found === undefined || found.groupSize <= 1) return undefined
  return { version: found.version, of: found.groupSize }
}
