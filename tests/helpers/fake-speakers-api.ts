// A minimal in-memory Airtable data API for the CRM write tests: list, create, update and
// delete, keyed by table name off the request URL.
//
// Five extra knobs a real base does not need:
//   - `poisonEmail` fails any Speakers write that includes it with a 422, simulating
//     Airtable's real batch-is-atomic behaviour (one bad record rejects the whole request).
//   - `poisonEmailSystemic` is the same shape, but fails with a 401 instead of a 422 - the
//     row-attributable classifier treats a 401 as an auth problem, not a rejected record, so
//     this simulates a systemic failure that only fires once a specific row's own isolated
//     retry is attempted, for testing the per-row fallback losing (or not losing) a sibling
//     row's already-settled success.
//   - `alwaysFailStatus` fails every Speakers write with that status regardless of content,
//     simulating a base-wide problem. Scoped to one HTTP method with `alwaysFailMethod`
//     when a test needs only the create or only the update sub-batch to fail. 401 is used
//     in the tests rather than 429, since 429 is intercepted and retried by the real
//     scheduler before it ever reaches here, which would make a test wait through real
//     backoff delays for nothing new.
//   - `truncateCreateResponseBy` answers a Speakers POST with N fewer records than were
//     requested, with no error at all, simulating a malformed-but-200 response.
//   - `failAfter` fails every write to one named table once it has seen more than N writes,
//     for testing what happens when `client.updateRecords`' internal 10-per-request
//     chunking hits a rejection on its second or later request.
//   - `emptyPatchResponseFor` answers a PATCH to the named table with 200 and `{ records: [] }`
//     regardless of what was requested, simulating a "successful response, wrong record
//     count" answer for a single-record update, distinct from a truncated CREATE response.
//   - `emptyCreateResponseFor` is the same thing for a POST, on any table (unlike
//     `truncateCreateResponseBy`, which is Speakers-only). The rows are still stored, because
//     that is the point: the record exists and the response cannot name it.
// `writeLog` records every write attempt (table and record count), regardless of outcome,
// so a test can assert how many requests actually reached the wire and how large each was.

type StoredRecord = { id: string; fields: Record<string, unknown> }
export type WriteLogEntry = { table: string; method: string; count: number }
type WriteRecord = { id?: string; fields?: Record<string, unknown> }
type FakeOptions = {
  initial?: Partial<Record<string, StoredRecord[]>>
  poisonEmail?: string
  poisonEmailSystemic?: string
  alwaysFailStatus?: number
  alwaysFailMethod?: 'POST' | 'PATCH'
  truncateCreateResponseBy?: number
  failAfter?: { table: string; afterWrites: number; status: number }
  emptyPatchResponseFor?: string
  emptyCreateResponseFor?: string
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function tableFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split('/').slice(3).join('/'))
}

type WriteAttempt = {
  table: string
  method: string
  records: readonly WriteRecord[]
  writeCountForTable: number
}

/** A write injected as failing, or `undefined` to let it proceed normally. */
function injectedFailure(attempt: WriteAttempt, options: FakeOptions): Response | undefined {
  const { table, method, records, writeCountForTable } = attempt

  if (
    options.failAfter !== undefined &&
    options.failAfter.table === table &&
    writeCountForTable > options.failAfter.afterWrites
  ) {
    return new Response('rejected', { status: options.failAfter.status })
  }
  if (table !== 'Speakers') return undefined
  if (
    options.alwaysFailStatus !== undefined &&
    (options.alwaysFailMethod === undefined || options.alwaysFailMethod === method)
  ) {
    return new Response('rejected', { status: options.alwaysFailStatus })
  }
  if (
    options.poisonEmail !== undefined &&
    records.some((r) => r.fields?.email === options.poisonEmail)
  ) {
    return new Response('rejected', { status: 422 })
  }
  if (
    options.poisonEmailSystemic !== undefined &&
    records.some((r) => r.fields?.email === options.poisonEmailSystemic)
  ) {
    return new Response('rejected', { status: 401 })
  }
  return undefined
}

export type ReadLogEntry = { table: string; tags?: readonly string[] }

export function fakeSpeakersApi(options: FakeOptions = {}) {
  const store = new Map<string, StoredRecord[]>()
  for (const [table, rows] of Object.entries(options.initial ?? {})) {
    store.set(table, rows === undefined ? [] : [...rows])
  }
  let nextId = 1
  const writeLog: WriteLogEntry[] = []
  const readLog: ReadLogEntry[] = []

  const tableRows = (table: string): StoredRecord[] => {
    const existing = store.get(table)
    if (existing !== undefined) return existing
    const created: StoredRecord[] = []
    store.set(table, created)
    return created
  }

  function handlePost(table: string, records: readonly WriteRecord[]): Response {
    const written = records.map((r) => {
      const row: StoredRecord = {
        id: `rec${String(nextId).padStart(5, '0')}`,
        fields: r.fields ?? {},
      }
      nextId += 1
      tableRows(table).push(row)
      return row
    })
    if (options.emptyCreateResponseFor === table) return json({ records: [] })
    const truncateBy = table === 'Speakers' ? (options.truncateCreateResponseBy ?? 0) : 0
    const returned =
      truncateBy > 0 ? written.slice(0, Math.max(0, written.length - truncateBy)) : written
    return json({ records: returned })
  }

  /** Merge-by-field-VALUE, for `client.upsertRecords`: records carry no `id` at all. */
  function upsertOne(table: string, mergeOn: readonly string[], record: WriteRecord): StoredRecord {
    // Map lookups, not computed indexing on a plain object: security/detect-object-injection
    // treats `obj[variableKey]` as an injection sink even here.
    const incoming = new Map(Object.entries(record.fields ?? {}))
    const existing = tableRows(table).find((candidate) => {
      const candidateFields = new Map(Object.entries(candidate.fields))
      return mergeOn.every((field) => candidateFields.get(field) === incoming.get(field))
    })
    if (existing !== undefined) {
      Object.assign(existing.fields, record.fields ?? {})
      return existing
    }
    const row: StoredRecord = {
      id: `rec${String(nextId).padStart(5, '0')}`,
      fields: record.fields ?? {},
    }
    nextId += 1
    tableRows(table).push(row)
    return row
  }

  function updateOne(table: string, record: WriteRecord): StoredRecord {
    const row = tableRows(table).find((candidate) => candidate.id === record.id)
    if (row === undefined) throw new Error(`${table}: no record ${record.id ?? ''}`)
    Object.assign(row.fields, record.fields ?? {})
    return row
  }

  function handlePatch(
    table: string,
    records: readonly WriteRecord[],
    mergeOn: readonly string[] | undefined,
  ): Response {
    if (options.emptyPatchResponseFor === table) return json({ records: [] })
    const written = records.map((r) =>
      mergeOn === undefined ? updateOne(table, r) : upsertOne(table, mergeOn, r),
    )
    return json({ records: written })
  }

  function handleDelete(table: string, url: string): Response {
    const ids = new URL(url).searchParams.getAll('records[]')
    store.set(
      table,
      tableRows(table).filter((row) => !ids.includes(row.id)),
    )
    return json({ records: ids.map((id) => ({ id })) })
  }

  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
    const table = tableFromUrl(url)
    const method = init?.method ?? 'GET'

    if (method === 'GET') {
      // `next` is a plain property on the RequestInit client.ts builds (cacheInit in
      // read-cache.ts), not a runtime-specific mechanism, so it survives being handed to a
      // stubbed global fetch untouched and is readable here like any other field.
      const next = (init as { next?: { tags?: readonly string[] } } | undefined)?.next
      readLog.push({ table, tags: next?.tags })
      return Promise.resolve(json({ records: tableRows(table) }))
    }
    if (method === 'DELETE') return Promise.resolve(handleDelete(table, url))

    const raw = typeof init?.body === 'string' ? init.body : '{}'
    const body = JSON.parse(raw) as {
      records?: WriteRecord[]
      performUpsert?: { fieldsToMergeOn?: string[] }
    }
    const records = body.records ?? []
    writeLog.push({ table, method, count: records.length })
    const writeCountForTable = writeLog.filter((entry) => entry.table === table).length

    const failure = injectedFailure({ table, method, records, writeCountForTable }, options)
    if (failure !== undefined) return Promise.resolve(failure)

    if (method === 'POST') return Promise.resolve(handlePost(table, records))
    if (method === 'PATCH') {
      return Promise.resolve(handlePatch(table, records, body.performUpsert?.fieldsToMergeOn))
    }
    throw new Error(`unexpected ${method} on ${table}`)
  }

  return { fetchImpl, rows: (table: string) => tableRows(table), writeLog, readLog }
}
