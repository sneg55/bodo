// A minimal in-memory Airtable data API, enough to run the seed against.
//
// It exists so the seed's two properties can be asserted without credentials: that a
// second run creates nothing, and that writes reach the wire in batches of at most ten.
// Only the three verbs the seed uses are implemented (list, create, patch), and
// anything else is an error rather than a silent 200, because a seed that started using
// a fourth verb should fail here loudly.

import { type AirtableClient, createClient } from '@/services/airtable/client'
import type { AirtableRecord, FieldSet } from '@/services/airtable/records'
import { createScheduler } from '@/services/airtable/scheduler'

type Row = { id: string; fields: Record<string, unknown> }

export type FakeAirtable = {
  client: AirtableClient
  /** Rows currently stored, by table name. */
  rows: (table: string) => readonly AirtableRecord[]
  /** Records per create request, in order. Asserts the 10-record ceiling. */
  createBatchSizes: readonly number[]
  requestCount: () => number
}

const BASE_ID = 'appFakeSeedBase'

function tableFromUrl(url: string): string {
  const path = new URL(url).pathname
  const encoded = path.slice(`/v0/${BASE_ID}/`.length)
  return decodeURIComponent(encoded)
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export function fakeAirtable(): FakeAirtable {
  const store = new Map<string, Row[]>()
  const createBatchSizes: number[] = []
  let requests = 0
  let nextId = 1

  const tableRows = (table: string): Row[] => {
    const existing = store.get(table)
    if (existing !== undefined) return existing
    const created: Row[] = []
    store.set(table, created)
    return created
  }

  function create(table: string, records: readonly { fields: FieldSet }[]): Response {
    createBatchSizes.push(records.length)
    const written = records.map((record) => {
      const row: Row = { id: `rec${String(nextId).padStart(5, '0')}`, fields: { ...record.fields } }
      nextId += 1
      tableRows(table).push(row)
      return row
    })
    return json({ records: written })
  }

  function patch(table: string, records: readonly { id: string; fields: FieldSet }[]): Response {
    const written = records.map((record) => {
      const row = tableRows(table).find((candidate) => candidate.id === record.id)
      if (row === undefined) throw new Error(`${table}: no record ${record.id}`)
      Object.assign(row.fields, record.fields)
      return row
    })
    return json({ records: written })
  }

  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
    requests += 1
    const table = tableFromUrl(url)
    const method = init?.method ?? 'GET'
    if (method === 'GET') {
      // One page, always. Pagination itself is covered by tests/airtable-client.test.ts.
      return Promise.resolve(json({ records: tableRows(table) }))
    }
    const raw = typeof init?.body === 'string' ? init.body : '{}'
    const body = JSON.parse(raw) as { records?: { id?: string; fields?: FieldSet }[] }
    const records = body.records ?? []
    if (method === 'POST') {
      return Promise.resolve(
        create(
          table,
          records.map((r) => ({ fields: r.fields ?? {} })),
        ),
      )
    }
    if (method === 'PATCH') {
      return Promise.resolve(
        patch(
          table,
          records.map((r) => ({ id: r.id ?? '', fields: r.fields ?? {} })),
        ),
      )
    }
    throw new Error(`unexpected ${method} on ${table}`)
  }

  const client = createClient({
    baseId: BASE_ID,
    token: 'patFake',
    scheduler: createScheduler({
      fetchImpl,
      // No real waiting and no real clock: the rate window is asserted in
      // tests/airtable-scheduler.test.ts, and the seed writes hundreds of rows.
      clock: { now: () => 0, sleep: () => ({ done: Promise.resolve(), wake: () => undefined }) },
      requestsPerSecond: 1_000_000,
    }),
  })

  return {
    client,
    rows: (table) => tableRows(table).map((row) => ({ id: row.id, fields: { ...row.fields } })),
    createBatchSizes,
    requestCount: () => requests,
  }
}
