// A small typed fetch client for the Airtable REST API.
//
// Not the `airtable` npm package. BUILD_SPEC 3.1 left that as a probe ("whether it
// behaves on workerd is unverified"); this is the answer. The package is a 2019
// Node client built on callbacks and its own request layer, it cannot be pointed
// at the scheduler in scheduler.ts, and every call it makes would bypass the rate
// cap that the rest of this directory exists to enforce. A fetch client is about
// 200 lines, all of them auditable, and it is what Workers gives us natively.
//
// Three rules are enforced here rather than trusted to callers:
//   - `listAll` returns only after the last page. A half-paginated list written
//     under a cache tag is a permanently wrong answer that looks correct, and it
//     stays wrong until something invalidates the tag.
//   - Writes chunk at 10 records, which is Airtable's batch ceiling.
//   - Caching is decided here, on the request, and a write is never cached. See
//     `ReadCache` for why the cache lives at this layer at all.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { phaseTracer } from '@/services/airtable/diag'
import { failureFor } from '@/services/airtable/failure'
import { cacheInit, type ReadCache, type RequestKind } from '@/services/airtable/read-cache'
import {
  type AirtableRecord,
  type FieldSet,
  parseBatch,
  parseListPage,
  parseRecord,
} from '@/services/airtable/records'
import { getScheduler, type Scheduler } from '@/services/airtable/scheduler'
import { getEnv } from '@/utils/env'

const API_ROOT = 'https://api.airtable.com/v0'

/** Airtable's ceilings, not ours. Section 3.1. */
export const MAX_PAGE_SIZE = 100
export const MAX_BATCH = 10

/**
 * A stop on runaway pagination. 100 pages is 10,000 records, well past anything a
 * conference base holds, so hitting it means Airtable is repeating an offset
 * rather than that the data is large. Without it a bad offset loops forever
 * holding a request open.
 */
const MAX_PAGES = 100

export type SortSpec = { field: string; direction?: 'asc' | 'desc' }

/**
 * A list read carries its caching with it, so the tags and the window a read declares
 * reach the request that actually performs it. Absent means uncached. See read-cache.ts
 * for why the cache lives on the request rather than in a `'use cache'` function.
 */
export type ListOptions = ReadCache & {
  filterByFormula?: string
  fields?: readonly string[]
  sort?: readonly SortSpec[]
  maxRecords?: number
  pageSize?: number
  view?: string
}

export type RecordPatch = { id: string; fields: FieldSet }

export type AirtableClient = {
  listAll: (table: string, options?: ListOptions) => Promise<readonly AirtableRecord[]>
  getRecord: (table: string, recordId: string, cache?: ReadCache) => Promise<AirtableRecord>
  createRecords: (table: string, records: readonly FieldSet[]) => Promise<readonly AirtableRecord[]>
  updateRecords: (
    table: string,
    patches: readonly RecordPatch[],
  ) => Promise<readonly AirtableRecord[]>
  /**
   * Create-or-update keyed on `fieldsToMergeOn`, so a retried fan-out does not
   * duplicate. Only usable where the natural key is plain columns: Airtable
   * cannot merge on a linked-record field. See mutations.ts.
   */
  upsertRecords: (
    table: string,
    fieldsToMergeOn: readonly string[],
    records: readonly FieldSet[],
  ) => Promise<readonly AirtableRecord[]>
  deleteRecords: (table: string, recordIds: readonly string[]) => Promise<readonly string[]>
}

export type ClientConfig = { baseId: string; token: string; scheduler: Scheduler }

/** Split into batches of `size`. Exported because the 10-record rule is testable. */
export function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size))
  }
  return out
}

function listParams(options: ListOptions, offset: string | undefined): URLSearchParams {
  const params = new URLSearchParams()
  params.set('pageSize', String(Math.min(options.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE)))
  if (options.filterByFormula !== undefined) {
    params.set('filterByFormula', options.filterByFormula)
  }
  if (options.maxRecords !== undefined) params.set('maxRecords', String(options.maxRecords))
  if (options.view !== undefined) params.set('view', options.view)
  for (const field of options.fields ?? []) params.append('fields[]', field)
  for (const [index, spec] of (options.sort ?? []).entries()) {
    params.set(`sort[${index}][field]`, spec.field)
    params.set(`sort[${index}][direction]`, spec.direction ?? 'asc')
  }
  if (offset !== undefined) params.set('offset', offset)
  return params
}

/** What `send` needs to know beyond the URL and the body. */
type SendSpec = { table: string; kind: RequestKind; cache?: ReadCache }

export function createClient(config: ClientConfig): AirtableClient {
  const headers = {
    authorization: `Bearer ${config.token}`,
    'content-type': 'application/json',
  }

  const url = (table: string, suffix = ''): string =>
    `${API_ROOT}/${config.baseId}/${encodeURIComponent(table)}${suffix}`

  /**
   * The one place a request leaves this directory, and therefore the one place
   * caching is applied. Nothing below builds a `next` field of its own: a read passes
   * the tags and window it declared, a write passes none and cannot be cached.
   */
  async function send(target: string, init: RequestInit, spec: SendSpec): Promise<unknown> {
    const response = await config.scheduler.fetch(target, {
      ...init,
      ...cacheInit(spec.kind, spec.cache),
      headers,
    })
    if (!response.ok) throw await failureFor(response, spec.table, spec.kind)
    return await response.json()
  }

  async function listAll(
    table: string,
    options: ListOptions = {},
  ): Promise<readonly AirtableRecord[]> {
    const collected: AirtableRecord[] = []
    let offset: string | undefined
    let pages = 0

    // Every page of one list carries the same tags and window, so a list that spans
    // three requests is expired by one tag rather than two thirds of it.
    const spec: SendSpec = { table, kind: 'read', cache: options }

    do {
      const target = `${url(table)}?${listParams(options, offset).toString()}`
      const page = parseListPage(await send(target, { method: 'GET' }, spec), table)
      collected.push(...page.records)
      offset = page.offset
      pages += 1
      if (pages > MAX_PAGES) {
        throw new AppError(ErrorIds.NET_BAD_SHAPE, `${table}: pagination did not terminate`, {
          table,
          pages,
          records: collected.length,
        })
      }
    } while (offset !== undefined)

    return collected
  }

  async function writeBatches(
    table: string,
    method: 'POST' | 'PATCH',
    payloads: readonly Record<string, unknown>[],
  ): Promise<readonly AirtableRecord[]> {
    const written: AirtableRecord[] = []
    for (const batch of payloads) {
      const body = JSON.stringify(batch)
      const result = await send(url(table), { method, body }, { table, kind: 'write' })
      written.push(...parseBatch(result, table))
    }
    return written
  }

  return {
    listAll,

    getRecord: async (table, recordId, cache) =>
      parseRecord(
        await send(
          url(table, `/${encodeURIComponent(recordId)}`),
          { method: 'GET' },
          {
            table,
            kind: 'read',
            cache,
          },
        ),
        table,
      ),

    createRecords: async (table, records) =>
      await writeBatches(
        table,
        'POST',
        chunk(records, MAX_BATCH).map((batch) => ({
          records: batch.map((fields) => ({ fields })),
        })),
      ),

    updateRecords: async (table, patches) =>
      await writeBatches(
        table,
        'PATCH',
        chunk(patches, MAX_BATCH).map((batch) => ({ records: batch })),
      ),

    upsertRecords: async (table, fieldsToMergeOn, records) =>
      await writeBatches(
        table,
        'PATCH',
        chunk(records, MAX_BATCH).map((batch) => ({
          performUpsert: { fieldsToMergeOn },
          records: batch.map((fields) => ({ fields })),
        })),
      ),

    deleteRecords: async (table, recordIds) => {
      const deleted: string[] = []
      for (const batch of chunk(recordIds, MAX_BATCH)) {
        const params = new URLSearchParams()
        for (const id of batch) params.append('records[]', id)
        const result = await send(
          `${url(table)}?${params.toString()}`,
          { method: 'DELETE' },
          {
            table,
            kind: 'write',
          },
        )
        // The delete response is `{ records: [{ id, deleted }] }`, and only the
        // ids matter to callers.
        deleted.push(...parseBatch(result, table).map((record) => record.id))
      }
      return deleted
    },
  }
}

/**
 * The configured client. Callers gate on `hasAirtable()` first (see source.ts);
 * reaching here without credentials is a bug, not a fallback, so it throws rather
 * than silently reading nothing.
 */
export function getClient(): AirtableClient {
  const env = getEnv()
  if (env.AIRTABLE_TOKEN === undefined || env.AIRTABLE_BASE_ID === undefined) {
    throw new AppError(
      ErrorIds.CFG_ENV_MISSING,
      'AIRTABLE_TOKEN and AIRTABLE_BASE_ID are unset, so the DAL is serving read-only fixtures',
      { hasToken: env.AIRTABLE_TOKEN !== undefined },
    )
  }
  return createClient({
    baseId: env.AIRTABLE_BASE_ID,
    token: env.AIRTABLE_TOKEN,
    scheduler: getScheduler(env.AIRTABLE_BASE_ID, { onPhase: phaseTracer() }),
  })
}
