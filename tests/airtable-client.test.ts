// The two invariants the client exists to hold: a list is only returned after the
// last page, and a write never sends more than 10 records in one request.
//
// The scheduler is faked, so no rate limiting and no network are involved. That is
// the point of taking it as a config parameter.

import { describe, expect, it } from 'vitest'

import { isAppError } from '@/constants/errorIds'
import { chunk, createClient, MAX_BATCH } from '@/services/airtable/client'
import { fieldEquals, quote } from '@/services/airtable/formula'
import type { Scheduler } from '@/services/airtable/scheduler'

type Call = { url: string; method: string; body?: string }

/** A scheduler whose fetch replays the given bodies and records what it was asked. */
function fakeScheduler(bodies: readonly unknown[], status = 200) {
  const calls: Call[] = []
  const scheduler: Scheduler = {
    fetch: (url, init) => {
      const index = calls.length
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      })
      const body = bodies.at(index) ?? bodies.at(-1)
      return Promise.resolve(
        new Response(JSON.stringify(body ?? {}), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      )
    },
  }
  return { scheduler, calls }
}

function client(bodies: readonly unknown[], status = 200) {
  const { scheduler, calls } = fakeScheduler(bodies, status)
  return { calls, api: createClient({ baseId: 'appTest', token: 'patTest', scheduler }) }
}

function records(...ids: readonly string[]) {
  return ids.map((id) => ({ id, fields: { name: id } }))
}

describe('listAll', () => {
  it('follows every offset before returning', async () => {
    const { api, calls } = client([
      { records: records('rec1', 'rec2'), offset: 'page2' },
      { records: records('rec3'), offset: 'page3' },
      { records: records('rec4') },
    ])

    const all = await api.listAll('Submissions')

    // A half-paginated list cached under a tag is a permanently wrong answer that
    // looks correct, so partial results must never leave this function.
    expect(all.map((record) => record.id)).toEqual(['rec1', 'rec2', 'rec3', 'rec4'])
    expect(calls).toHaveLength(3)
    expect(calls.at(1)?.url).toContain('offset=page2')
    expect(calls.at(0)?.url).not.toContain('offset=')
  })

  it('asks for the largest page Airtable allows', async () => {
    const { api, calls } = client([{ records: [] }])

    await api.listAll('Submissions')

    expect(calls.at(0)?.url).toContain('pageSize=100')
  })

  it('passes a formula, a projection and a sort through in Airtable syntax', async () => {
    const { api, calls } = client([{ records: [] }])

    await api.listAll('Forms', {
      filterByFormula: fieldEquals('publicId', 'abc123'),
      fields: ['name', 'publicId'],
      sort: [{ field: 'name' }, { field: 'order', direction: 'desc' }],
      maxRecords: 1,
    })

    const url = calls.at(0)?.url ?? ''
    expect(url).toContain('filterByFormula=%7BpublicId%7D+%3D+%27abc123%27')
    expect(url).toContain('fields%5B%5D=name')
    expect(url).toContain('sort%5B0%5D%5Bfield%5D=name')
    expect(url).toContain('sort%5B1%5D%5Bdirection%5D=desc')
    expect(url).toContain('maxRecords=1')
  })

  it('encodes the table name so a space does not break the path', async () => {
    const { api, calls } = client([{ records: [] }])

    await api.listAll('Submission Participants')

    expect(calls.at(0)?.url).toContain('/appTest/Submission%20Participants?')
  })

  it('raises a not-found error for a 404 rather than returning nothing', async () => {
    const { api } = client([{ error: 'NOT_FOUND' }], 404)

    const thrown = await api.listAll('Ghosts').catch((error: unknown) => error)

    expect(isAppError(thrown) ? thrown.id : '').toBe('E_DATA_001')
  })
})

describe('write batching', () => {
  it('splits creates into requests of at most 10 records', async () => {
    const { api, calls } = client([{ records: records('recNew') }])
    const fields = Array.from({ length: 23 }, (_, index) => ({ title: `row ${index}` }))

    await api.createRecords('Submissions', fields)

    // 23 rows is 10 + 10 + 3, because 10 is Airtable's ceiling per batch.
    expect(calls).toHaveLength(3)
    expect(calls.every((call) => call.method === 'POST')).toBe(true)
    const sizes = calls.map(
      (call) => (JSON.parse(call.body ?? '{}') as { records: unknown[] }).records.length,
    )
    expect(sizes).toEqual([10, 10, 3])
  })

  it('wraps create payloads as { records: [{ fields }] }', async () => {
    const { api, calls } = client([{ records: records('recNew') }])

    await api.createRecords('Tracks', [{ name: 'Agents' }])

    expect(JSON.parse(calls.at(0)?.body ?? '{}')).toEqual({
      records: [{ fields: { name: 'Agents' } }],
    })
  })

  it('sends updates as PATCH with the record id inside each entry', async () => {
    const { api, calls } = client([{ records: records('rec1') }])

    await api.updateRecords('Submissions', [{ id: 'rec1', fields: { status: 'accepted' } }])

    expect(calls.at(0)?.method).toBe('PATCH')
    expect(JSON.parse(calls.at(0)?.body ?? '{}')).toEqual({
      records: [{ id: 'rec1', fields: { status: 'accepted' } }],
    })
  })

  it('carries performUpsert on an upsert so a retry does not duplicate', async () => {
    const { api, calls } = client([{ records: records('rec1') }])

    await api.upsertRecords('EmailOutbox', ['idempotencyKey'], [{ idempotencyKey: 'k1' }])

    expect(JSON.parse(calls.at(0)?.body ?? '{}')).toEqual({
      performUpsert: { fieldsToMergeOn: ['idempotencyKey'] },
      records: [{ fields: { idempotencyKey: 'k1' } }],
    })
  })

  it('reports a rejected write as a write failure, not a bad shape', async () => {
    const { api } = client([{ error: { type: 'INVALID_REQUEST' } }], 422)

    const thrown = await api
      .createRecords('Submissions', [{ title: 'x' }])
      .catch((error: unknown) => error)

    expect(isAppError(thrown) ? thrown.id : '').toBe('E_DATA_003')
  })

  it('batches deletes as repeated records[] query parameters', async () => {
    const { api, calls } = client([{ records: records('rec1', 'rec2') }])

    await api.deleteRecords('Reviews', ['rec1', 'rec2'])

    expect(calls.at(0)?.method).toBe('DELETE')
    expect(calls.at(0)?.url).toContain('records%5B%5D=rec1&records%5B%5D=rec2')
  })
})

describe('chunk', () => {
  it('keeps every item and never exceeds the batch size', () => {
    const batches = chunk([1, 2, 3, 4, 5], 2)

    expect(batches).toEqual([[1, 2], [3, 4], [5]])
    expect(MAX_BATCH).toBe(10)
  })

  it('returns nothing for an empty input rather than one empty batch', () => {
    expect(chunk([], 10)).toEqual([])
  })
})

describe('formula quoting', () => {
  it('escapes an apostrophe so a name does not truncate the string', () => {
    // Unescaped, `{lastName} = 'O'Neil'` is a malformed formula, and Airtable's
    // answer to a malformed filter is to ignore it and return the whole table.
    expect(quote("O'Neil")).toBe("'O\\'Neil'")
  })

  it('escapes a backslash before the quote so the escape cannot be escaped', () => {
    expect(quote('a\\b')).toBe("'a\\\\b'")
  })

  it('builds an equality comparison', () => {
    expect(fieldEquals('publicId', 'abc')).toBe("{publicId} = 'abc'")
  })
})
