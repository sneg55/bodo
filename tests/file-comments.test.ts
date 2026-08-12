// Comments on an uploaded file.
//
// The mapper is the part worth testing directly: this table is visible in the Airtable
// grid, and pressing `+` there creates a blank row. A mapper that threw on one would turn
// a stray click into a 500 on the files page, which is the failure ContentRevisions next
// door was written tolerantly to avoid.

import { describe, expect, it } from 'vitest'

import { mapFileComment } from '@/services/airtable/file-comments'
import type { AirtableRecord } from '@/services/airtable/records'

const record = (fields: Record<string, unknown>, id = 'recCmt1'): AirtableRecord => ({ id, fields })

describe('mapFileComment', () => {
  it('reads a complete row', () => {
    const comment = mapFileComment(
      record({
        at: '2026-08-09T10:00:00.000Z',
        event: ['recEvent1'],
        file: ['recFile1'],
        body: 'Please re-export without the speaker notes.',
        authorName: 'Sam Organizer',
      }),
    )

    expect(comment).toEqual({
      id: 'recCmt1',
      eventId: 'recEvent1',
      fileId: 'recFile1',
      body: 'Please re-export without the speaker notes.',
      authorName: 'Sam Organizer',
      at: '2026-08-09T10:00:00.000Z',
    })
  })

  it('survives the blank row a stray click in the Airtable grid creates', () => {
    // Every field absent. It must map to something renderable rather than throw, because
    // one accidental `+` would otherwise take the whole files page down.
    const comment = mapFileComment(record({}))

    expect(comment.eventId).toBe('')
    expect(comment.fileId).toBe('')
    expect(comment.body).toBe('')
    expect(comment.at).toBe('')
  })

  it('names an unattributed comment rather than showing nothing', () => {
    // A row typed straight into the grid has no author. "Unknown" is honest; an empty
    // byline reads as a rendering bug.
    expect(mapFileComment(record({ body: 'hi' })).authorName).toBe('Unknown')
  })

  it('keeps an empty body as empty rather than inventing text', () => {
    expect(mapFileComment(record({ authorName: 'Sam' })).body).toBe('')
  })
})
