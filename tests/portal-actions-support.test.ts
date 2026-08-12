// CNT-02's completion rule: an upload task's fileId falls back to what was already saved on
// the assignment when the posted form carries none.
//
// Filed against the deployed build: a reload discarded `TaskCompletion.tsx`'s component state,
// and `Mark complete` refused a task whose file the speaker had already sent, because the only
// place that fileId lived was the browser tab that had just been reloaded. `saveTaskUploadAction`
// now persists it onto the assignment the moment the upload succeeds, and this is the pure rule
// that reads it back.

import { describe, expect, it } from 'vitest'

import { withStoredFileFallback } from '@/features/portal/actions-support'
import { assignment, task } from './helpers/portal-fakes'

describe('withStoredFileFallback', () => {
  const uploadTask = task({ kind: 'upload' })

  it('recovers the stored fileId when the post carries none, surviving a reload', () => {
    const item = {
      task: uploadTask,
      assignment: assignment({ answers: { fileId: 'recFileStored' } }),
    }

    expect(withStoredFileFallback(item, {})).toEqual({ fileId: 'recFileStored' })
  })

  it('treats a whitespace-only posted fileId the same as none', () => {
    const item = {
      task: uploadTask,
      assignment: assignment({ answers: { fileId: 'recFileStored' } }),
    }

    expect(withStoredFileFallback(item, { fileId: '   ' })).toEqual({ fileId: 'recFileStored' })
  })

  it('trusts a real posted fileId over whatever was saved earlier', () => {
    const item = {
      task: uploadTask,
      assignment: assignment({ answers: { fileId: 'recFileStored' } }),
    }

    expect(withStoredFileFallback(item, { fileId: 'recFileFresh' })).toEqual({
      fileId: 'recFileFresh',
    })
  })

  it('still resolves to no file when nothing was ever saved, so buildCompletion still refuses', () => {
    const item = { task: uploadTask, assignment: assignment() }

    expect(withStoredFileFallback(item, {})).toEqual({ fileId: undefined })
  })

  it('ignores a malformed stored value rather than trusting an unknown shape', () => {
    const item = {
      task: uploadTask,
      // `answers` is `Record<string, unknown>`: nothing stops a future write from putting a
      // non-string under `fileId`, and this must not hand that through as though it resolved.
      assignment: assignment({ answers: { fileId: 42 } }),
    }

    expect(withStoredFileFallback(item, {})).toEqual({ fileId: undefined })
  })

  it('leaves every other task kind alone, since only upload has this fallback', () => {
    const item = {
      task: task({ kind: 'confirm' }),
      assignment: assignment({ answers: { fileId: 'recFileStored' } }),
    }

    expect(withStoredFileFallback(item, { confirmed: true })).toEqual({ confirmed: true })
  })
})
