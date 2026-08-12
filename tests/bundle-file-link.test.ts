// The file-selection download URL, round tripped.
//
// A parameter name that disagrees between the builder and the parser downloads the wrong
// files with no error anywhere, which is why the assertion is a round trip rather than a
// string comparison against a literal.

import { describe, expect, it } from 'vitest'

import {
  FILE_BUNDLE_DOWNLOAD_PATH,
  type FileBundleRequest,
  fileBundleDownloadPath,
  parseFileBundleRequest,
} from '@/features/bundle/file-link'

const REQUEST: FileBundleRequest = {
  eventId: 'rec-event-1',
  fileIds: ['f-1', 'f-2'],
  grouping: 'speaker',
}

function parsePath(path: string): FileBundleRequest {
  return parseFileBundleRequest(new URL(`https://bodo.example${path}`).searchParams)
}

describe('fileBundleDownloadPath', () => {
  it('round trips a request through the URL', () => {
    expect(parsePath(fileBundleDownloadPath(REQUEST))).toEqual(REQUEST)
  })

  it('points at the route that streams the archive', () => {
    expect(fileBundleDownloadPath(REQUEST).startsWith(`${FILE_BUNDLE_DOWNLOAD_PATH}?`)).toBe(true)
  })

  it('escapes an id rather than letting it open a second parameter', () => {
    const path = fileBundleDownloadPath({ ...REQUEST, eventId: 'rec&files=f-9' })

    expect(parsePath(path).eventId).toBe('rec&files=f-9')
    expect(parsePath(path).fileIds).toEqual(['f-1', 'f-2'])
  })
})

describe('parseFileBundleRequest', () => {
  it('falls back to the default grouping for a value it does not know', () => {
    expect(
      parsePath(`${FILE_BUNDLE_DOWNLOAD_PATH}?eventId=e&files=f-1&group=nonsense`).grouping,
    ).toBe('session')
  })

  it('reads a blank event id as blank, so the role check refuses it', () => {
    expect(parsePath(`${FILE_BUNDLE_DOWNLOAD_PATH}?files=f-1`).eventId).toBe('')
  })

  it('drops empty segments and duplicates rather than sending them to the read', () => {
    expect(
      parsePath(`${FILE_BUNDLE_DOWNLOAD_PATH}?eventId=e&files=f-1,,f-2,%20,f-1`).fileIds,
    ).toEqual(['f-1', 'f-2'])
  })

  it('answers an absent files parameter with an empty selection, not an implicit everything', () => {
    expect(parsePath(`${FILE_BUNDLE_DOWNLOAD_PATH}?eventId=e`).fileIds).toEqual([])
  })
})
