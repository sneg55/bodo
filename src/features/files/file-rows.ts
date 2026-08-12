// The row model for the two admin Files lists, and the split between them.
//
// Pure, so it is unit tested (tests/file-rows.test.ts): the scopes below decide which of two
// screens a file appears on, and getting it wrong hides a delivered document rather than
// showing it in the wrong place.
//
// EACH LIST NOW MATCHES ITS OWN SUBTITLE, and they OVERLAP. SUBMISSIONS > Files is
// "everything attached to a submission"; PORTALS > Files is "headshots and requested
// documents, uploaded through the portal". A requested document that is also filed against
// a session answers both descriptions, so it is on both.
//
// It used to be a partition on `submissionId` alone, and the partition was the bug: a
// speaker's portal upload against a per-session file request has a `submissionId`, so it was
// on the submissions list only, and PORTALS > Files answered "what has this speaker uploaded
// through the portal" by omitting exactly that. Measured on the running app: Dara Nasser's
// requested slides.pdf, uploaded from her portal, was on SUBMISSIONS > Files with its
// versions and on PORTALS > Files not at all, while both screens tagged their rows
// "Requested". Neither list was then true about the same class of file.
//
// The cost of the overlap is a file listed twice, which is honest, and the cost of the
// partition was a file listed nowhere a reader would look, which is not.
//
// Nothing here reads Airtable, the clock, or the environment. The public URL is derived by
// the caller, because `publicUrlFor` reads `R2_PUBLIC_BASE_URL` and raises without it.

import { fileVersions } from '@/features/files/versions'
import type { RecordId, Speaker, StoredFile, SubmissionWithParticipants } from '@/types/domain'

export const FILE_SCOPES = ['submissions', 'portal'] as const
export type FileScope = (typeof FILE_SCOPES)[number]

export type FileRow = {
  readonly id: RecordId
  readonly filename: string
  readonly objectKey: string
  readonly sizeLabel: string
  /** "Headshot", "Slides", "Document". The stored `kind` is not shown raw. */
  readonly typeLabel: string
  readonly speakerLabel: string
  /** "SESS-12 Scaling Postgres", or absent on the portal list where there is no session. */
  readonly sessionLabel?: string
  /** True when the file arrived against a File Request rather than as a free upload. */
  readonly requested: boolean
  readonly visibility: StoredFile['visibility']
  /** ISO, for sorting. The formatted string is `uploadedText`. */
  readonly uploadedAt: string
  readonly uploadedText: string
  /** 1-based position in its version group. See `versions.ts`. */
  readonly version: number
  /** True for the newest upload of the same thing: the one to open. */
  readonly isLatest: boolean
  /** How many uploads of the same thing exist, so a row can say "2 of 3". */
  readonly groupSize: number
}

const TYPE_LABELS: ReadonlyMap<StoredFile['kind'], string> = new Map([
  ['headshot', 'Headshot'],
  ['slides', 'Slides'],
  ['doc', 'Document'],
])

export function fileTypeLabel(kind: StoredFile['kind']): string {
  return TYPE_LABELS.get(kind) ?? 'File'
}

/**
 * Bytes as something an organizer can act on. Whole megabytes, or kilobytes below one, and
 * never "0 KB", which reads as a broken row rather than a small file.
 *
 * Deliberately the same rule as `features/bundle/format.ts`, which labels the archive the
 * Options menu builds out of these same files: two files reported as 3 MB should not add up
 * to a bundle reported as 2 MB. It is not imported from there because that module is about
 * a bundle's total and this is about one row.
 */
export function fileSizeLabel(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  if (megabytes >= 1) return `${String(Math.round(megabytes))} MB`
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
}

/**
 * Whether a file belongs on one of the two lists. See the note at the top: they overlap.
 *
 * The portal test is "not filed against a session, OR delivered against a file request",
 * which is the subtitle that screen already carries. A headshot and a free portal upload
 * have no submission; a requested document has one whenever the request was per-session, and
 * that is the case the old test dropped.
 */
export function inFileScope(file: StoredFile, scope: FileScope): boolean {
  if (scope === 'submissions') return file.submissionId !== undefined
  return file.submissionId === undefined || file.fileRequestAssignmentId !== undefined
}

export type FileRowLookups = {
  readonly speakers: readonly Speaker[]
  readonly submissions: readonly SubmissionWithParticipants[]
  /** Formats an upload timestamp in the event's timezone. Injected so this stays pure. */
  readonly formatDate: (iso: string) => string
}

/**
 * One row per file, newest first, scoped to one of the two lists.
 *
 * A file whose submission is not in `submissions` is DROPPED from BOTH lists rather than
 * shown with a blank session. The read that produced it is scoped by the event's speaker
 * roster, and a speaker who presents at two events legitimately owns files against the other
 * one's sessions: showing those here would leak another event's titles. It has to be both
 * lists now that the portal scope admits a file with a submission, since dropping the
 * session label is not enough on its own: the filename is the other event's too.
 */
export function buildFileRows(
  files: readonly StoredFile[],
  scope: FileScope,
  lookups: FileRowLookups,
): readonly FileRow[] {
  const speakerById = new Map(lookups.speakers.map((speaker) => [speaker.id, speaker]))
  const sessionById = new Map(
    lookups.submissions.map((submission) => [
      submission.id,
      `${submission.code} ${submission.title}`.trim(),
    ]),
  )

  // Computed over EVERY file, before the scope filter, so a version count is not distorted
  // by the list it happens to be rendered in.
  const versions = fileVersions(files)

  const rows: FileRow[] = []
  for (const file of files) {
    if (!inFileScope(file, scope)) continue

    const sessionLabel =
      file.submissionId === undefined ? undefined : sessionById.get(file.submissionId)
    if (file.submissionId !== undefined && sessionLabel === undefined) continue

    rows.push({
      id: file.id,
      filename: file.filename,
      objectKey: file.objectKey,
      sizeLabel: fileSizeLabel(file.size),
      typeLabel: fileTypeLabel(file.kind),
      speakerLabel: speakerLabel(speakerById.get(file.speakerId)),
      ...(sessionLabel === undefined ? {} : { sessionLabel }),
      requested: file.fileRequestAssignmentId !== undefined,
      visibility: file.visibility,
      version: versions.get(file.id)?.version ?? 1,
      isLatest: versions.get(file.id)?.isLatest ?? true,
      groupSize: versions.get(file.id)?.groupSize ?? 1,
      uploadedAt: file.uploadedAt,
      uploadedText: lookups.formatDate(file.uploadedAt),
    })
  }

  return rows.sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
}

/**
 * The owner's name, or their email when they have no name yet, or a plain marker when the
 * roster no longer holds them. The last case is a deleted speaker with files still stored,
 * and a blank cell there looks like a rendering fault.
 */
function speakerLabel(speaker: Speaker | undefined): string {
  if (speaker === undefined) return 'Unknown speaker'
  const full = `${speaker.firstName} ${speaker.lastName}`.trim()
  return full.length > 0 ? full : speaker.email
}
