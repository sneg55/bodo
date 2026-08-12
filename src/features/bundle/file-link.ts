// The download URL for a file-row selection, and why it carries the ids rather than a token.
//
// Same answer as ./link, for the same reasons, and they are worth restating because this URL
// is built in the browser rather than mailed: it is NOT a capability. The route reads
// `requireEventRole` off the caller's own session, re-derives the event's roster and its
// files from event-scoped reads, and intersects the ids in the query against them. So editing
// this URL can only ever produce a bundle of files the caller could already download one at a
// time from the same screen, and a URL forwarded to somebody with no membership is a 401.
//
// The one difference from ./link: this carries the INCLUDED ids, not a selection plus a list
// of opt-outs. The dialog applies the unticks before it builds the URL, which halves the
// worst-case query length and removes the only way the two lists could contradict each other.
//
// Pure and round-trip tested (tests/bundle-file-link.test.ts), because a parameter name that
// disagrees between the builder and the parser is a download of the wrong files with no error
// anywhere.

import { type BundleGrouping, parseGrouping } from '@/features/bundle/grouping'

export const FILE_BUNDLE_DOWNLOAD_PATH = '/api/files/bundle/selection'

const PARAM = {
  eventId: 'eventId',
  files: 'files',
  group: 'group',
} as const

export type FileBundleRequest = {
  readonly eventId: string
  /** Exactly what goes in the archive, after the dialog's unticks. */
  readonly fileIds: readonly string[]
  readonly grouping: BundleGrouping
}

/** Comma separated rather than a repeated key: shorter, and it survives a link rewriter. */
function joinIds(ids: readonly string[]): string {
  return ids.join(',')
}

function splitIds(value: string | null): readonly string[] {
  if (value === null) return []
  return [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    ),
  ]
}

export function fileBundleDownloadQuery(request: FileBundleRequest): string {
  const params = new URLSearchParams()
  params.set(PARAM.eventId, request.eventId)
  params.set(PARAM.files, joinIds(request.fileIds))
  params.set(PARAM.group, request.grouping)
  return params.toString()
}

/** Path plus query, relative. The dialog navigates to it; nothing emails it. */
export function fileBundleDownloadPath(request: FileBundleRequest): string {
  return `${FILE_BUNDLE_DOWNLOAD_PATH}?${fileBundleDownloadQuery(request)}`
}

/**
 * The request a download URL describes.
 *
 * Nothing here is trusted: `eventId` is what `requireEventRole` is then asked about, the file
 * ids are intersected with the event's own, and an unknown grouping falls back to the default
 * rather than throwing, because it is a view knob. So a malformed URL produces a smaller
 * bundle or a 401, never a wider one.
 */
export function parseFileBundleRequest(params: URLSearchParams): FileBundleRequest {
  return {
    eventId: (params.get(PARAM.eventId) ?? '').trim(),
    fileIds: splitIds(params.get(PARAM.files)),
    grouping: parseGrouping(params.get(PARAM.group)),
  }
}
