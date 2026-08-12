// What the portal's Files card shows a speaker about their own uploads.
//
// The organizer side has had this since uploads shipped: PROGRAM > Files renders each
// upload as its own row, chipped `Latest of 2` or `v1`, with a Download control on every
// one. The speaker looking at the same two objects saw two identical `slides.pdf / 605 B /
// Private` lines with nothing to click, which is worse than it sounds: re-uploading has
// always created a new row and never deleted the old one, so a speaker who had corrected a
// deck could not tell whether the fix had landed, could not see which file the organizer
// would open, and could not open either of them to check.
//
// Pure, and unit tested (tests/portal-submission-files.test.ts), for the same reason
// `file-rows.ts` is: the grouping decides which upload is presented as current, and getting
// that wrong tells a speaker their old slides are the ones being presented.
//
// The version facts come from `@/features/files/versions`, the SAME function the admin list
// uses, deliberately and not by coincidence. Two implementations of "which upload
// supersedes which" would eventually disagree, and the whole complaint this closes is that
// the two sides of the product described the same two files differently.

import { fileVersions } from '@/features/files/versions'
import type { RecordId, StoredFile } from '@/types/domain'

export type SubmissionFileView = {
  readonly id: string
  readonly filename: string
  readonly sizeLabel: string
  /** Where the Open/Download control points. Absent only when nothing can serve the object. */
  readonly href?: string
  /** True when the link is the authenticated route, so the control saves rather than navigates. */
  readonly download: boolean
  readonly visibility: StoredFile['visibility']
  /** 1-based position in its version group. */
  readonly version: number
  /** True for the newest upload of the same thing: the one the organizer opens. */
  readonly isLatest: boolean
  /** How many uploads of the same thing exist, so a row can say `Latest of 3`. */
  readonly groupSize: number
  /** ISO, for ordering. `uploadedText` is what a person reads. */
  readonly uploadedAt: string
  /**
   * Date AND TIME, in the event's timezone.
   *
   * The date alone was not enough and that was the second half of the gap: two uploads of a
   * corrected deck on the same afternoon both read `Aug 9, 2026`, so the version chips were
   * the only thing distinguishing them and nothing on either side of the product could be
   * ordered by what it displayed.
   */
  readonly uploadedText: string
}

export type SubmissionFileLookups = {
  /** Formats an upload timestamp in the event's timezone. Injected so this stays pure. */
  readonly formatDateTime: (iso: string) => string
  /**
   * The public bucket URL for an object, or `undefined` when none is configured.
   *
   * Injected because `publicUrlFor` reads `R2_PUBLIC_BASE_URL` and raises without it, which
   * is correct for an upload path and wrong for a read: a missing base URL should cost this
   * card its links, not the whole page.
   */
  readonly publicUrl: (objectKey: string) => string | undefined
  /** The submission code, so a private object's link can be scoped to it. */
  readonly submissionCode: string
}

/**
 * One row per upload, NEWEST FIRST, with its version facts and a way to open it.
 *
 * Newest first rather than oldest, matching the admin list: the current deck is the one a
 * speaker checking their submission wants at the top, and the history reads downwards from
 * it. Within one instant the record id breaks the tie, so the order is total and does not
 * change between reads.
 *
 * A PRIVATE object gets the authenticated portal route, which re-derives ownership from the
 * session rather than trusting the id in the URL (see `own-file.ts`). A public one links
 * straight at the bucket. Neither link is a capability.
 */
export function submissionFileViews(
  files: readonly StoredFile[],
  lookups: SubmissionFileLookups,
): readonly SubmissionFileView[] {
  const versions = fileVersions(files)

  return files
    .map((file) => {
      const version = versions.get(file.id)
      const href = hrefFor(file, lookups)
      return {
        id: file.id,
        filename: file.filename,
        sizeLabel: formatFileSize(file.size),
        ...(href === undefined ? {} : { href }),
        download: file.visibility === 'private' && href !== undefined,
        visibility: file.visibility,
        version: version?.version ?? 1,
        isLatest: version?.isLatest ?? true,
        groupSize: version?.groupSize ?? 1,
        uploadedAt: file.uploadedAt,
        uploadedText: lookups.formatDateTime(file.uploadedAt),
      }
    })
    .sort(
      (left, right) =>
        right.uploadedAt.localeCompare(left.uploadedAt) || right.id.localeCompare(left.id),
    )
}

function hrefFor(file: StoredFile, lookups: SubmissionFileLookups): string | undefined {
  if (file.visibility === 'public') return lookups.publicUrl(file.objectKey)
  return portalFileHref(file.id, lookups.submissionCode)
}

/**
 * The authenticated portal download link.
 *
 * The submission code rides in the query for the reason the admin route puts the event id
 * there: a `Files` row records a SPEAKER, so there is nothing on the file to scope by, and
 * the code names the set the route then looks inside. It carries no capability, because
 * `readOwnSubmissionByCode` filters to the caller's own submissions before resolving it:
 * naming somebody else's code finds nothing, and naming your own with a foreign file id
 * finds nothing either.
 */
export function portalFileHref(fileId: RecordId, submissionCode?: string): string {
  const base = `/api/portal/files/${fileId}`
  // Omitted for a file the caller uploaded themselves (a headshot, a delivered file
  // request): `getOwnFile` then searches their own uploads, which is the narrower set.
  if (submissionCode === undefined) return base
  return `${base}?submission=${encodeURIComponent(submissionCode)}`
}

/**
 * Bytes as something a speaker can read. Bytes below a kilobyte, because the portal shows
 * small text files and `0 KB` reads as a broken row rather than as a small file.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
