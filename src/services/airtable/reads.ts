// Live reads against Airtable: events, submissions, forms.
//
// Each read declares its own caching, because each read is the only thing that knows
// which table it is hitting and which event it is scoped to. It used to be declared one
// layer up, in a `'use cache'` function per read in queries.ts; that layer is gone
// (read-cache.ts explains why) and the tags now travel down to the request. The tag
// vocabulary itself is unchanged: it is what the mutations invalidate.
//
// The reads a MUTATION uses pass no cache at all and must stay that way. A write that
// decides between create and update from a cached read can act on data that is already
// gone, and the ones here that a write depends on (`findByText` for the speaker upsert)
// are uncached by default rather than by remembering to opt out.
//
// Why these filter in code instead of with `filterByFormula`: an Airtable formula
// sees a linked record as its primary field's TEXT, never as a record id. So
// `{event} = 'recABC'` matches nothing at all, and `{event} = 'AI Engineer
// Sandbox'` silently returns nothing the day someone renames the event. Filtering
// after the map is the correct operation, and since every list here carries its tags
// into the Data Cache, the pages are paid for once per invalidation rather than
// once per request. Text columns are a different matter: `publicId` and `email`
// are real strings, so those reads do use a formula (see formula.ts).

import { AppError, ErrorIds } from '@/constants/errorIds'
import { type AirtableClient, getClient, type SortSpec } from '@/services/airtable/client'
import { fieldEquals } from '@/services/airtable/formula'
import { mapEvent, mapSubmission } from '@/services/airtable/mapping'
import { mapForm } from '@/services/airtable/mapping-forms'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import type { AirtableRecord } from '@/services/airtable/records'
import { attachParticipants, loadCast } from '@/services/airtable/submission-cast'
import { COL, TABLES } from '@/services/airtable/tables'
import {
  eventAgendaPublishedTag,
  eventAgendaTag,
  eventFormsTag,
  eventSlugTag,
  eventSpeakersTag,
  eventSubmissionsTag,
  eventTag,
  formPublicTag,
  submissionTag,
} from '@/services/airtable/tags'
import type {
  Event,
  Speaker,
  Submission,
  SubmissionParticipant,
  SubmissionWithParticipants,
} from '@/types/domain'
import type { Form } from '@/types/forms'
import { hasAirtable } from '@/utils/env'

export const byOrder: readonly SortSpec[] = [{ field: COL.order, direction: 'asc' }]

/**
 * Paginates to completion, maps, then keeps the rows belonging to one event.
 *
 * `sort` and `cache` are one options bag rather than two parameters because callers in
 * three files pass different combinations of them and a positional `undefined` in the
 * middle reads as an accident.
 */
export async function listByEvent<T extends { eventId: string }>(
  table: string,
  eventId: string,
  map: (record: AirtableRecord) => T,
  options: { sort?: readonly SortSpec[]; cache?: ReadCache } = {},
): Promise<readonly T[]> {
  // The fixture branch, matching `reads-dashboards.ts:40` and `reads-prescreen.ts:58`.
  // This helper reaches `getClient()` rather than `getSource()`, so on a clone with an
  // empty `.env` it can only ever throw CFG_ENV_MISSING — and it throws during render, so
  // the whole page 500s rather than the one list coming back empty. Guarding here rather
  // than at each call site because every caller has the same problem: /portals was the one
  // that surfaced it, via listPortals. In a configured deployment `hasAirtable()` is true
  // and this never fires.
  if (!hasAirtable()) return []
  const records = await getClient().listAll(table, { ...options.cache, sort: options.sort })
  return records.map(map).filter((row) => row.eventId === eventId)
}

/**
 * First match on a text column, or `undefined`. Formula-safe: see formula.ts.
 *
 * Uncached unless a caller asks: the speaker upsert in mutations.ts finds-or-creates
 * through this, and a cached miss there is how one speaker ends up with two records.
 */
export async function findByText(
  table: string,
  field: string,
  value: string,
  cache?: ReadCache,
): Promise<AirtableRecord | undefined> {
  const records = await getClient().listAll(table, {
    ...cache,
    filterByFormula: fieldEquals(field, value),
    maxRecords: 1,
  })
  return records.at(0)
}

function notFound(table: string, key: string, value: string): AppError {
  return new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, `${table}: no record with ${key} ${value}`, {
    table,
    key,
    value,
  })
}

export async function getEvent(eventId: string): Promise<Event> {
  return mapEvent(
    await getClient().getRecord(TABLES.events, eventId, {
      tags: [eventTag(eventId)],
      revalidate: REVALIDATE.lookup,
    }),
  )
}

/**
 * One event by the slug a public URL carries. Absent is a normal answer.
 *
 * `slug` is real text on the Events table and not a link, so unlike the event-scoped
 * lists above this read CAN filter server side. It goes through `findByText`, which
 * quotes the value: an unescaped apostrophe does not fail, it makes Airtable ignore the
 * filter and hand back the whole table, which would resolve a bogus slug to whichever
 * event happens to sort first (formula.ts).
 *
 * Returns `undefined` instead of throwing because the caller is a public page, where an
 * unknown slug is a 404 rather than an error worth an id and a log line.
 */
export async function getEventBySlug(slug: string): Promise<Event | undefined> {
  const record = await findByText(TABLES.events, COL.slug, slug, {
    tags: [eventSlugTag(slug)],
    revalidate: REVALIDATE.lookup,
  })
  return record === undefined ? undefined : mapEvent(record)
}

/**
 * What every request behind one event's submissions subscribes to.
 *
 * Four tags where the old `'use cache'` function named one, because a cache entry is now
 * keyed on the HTTP request: the abstracts table, the agenda board and the public agenda
 * are all served from the SAME cached page of `Submissions` rows. A read has to name
 * every tag a write of that data expires, or one of those screens keeps serving an entry
 * the others have already refreshed. Room and time are columns on the submission row,
 * which is why the agenda tags belong here; the resolved cast is why the speaker tag
 * does.
 *
 * The asymmetry with the write side is deliberate. A mutation still names only the tags
 * it affects (BUILD_SPEC 6.1): subscribing widely costs one Airtable request,
 * invalidating widely costs every screen in the product.
 */
function submissionsCache(eventIds: readonly string[]): ReadCache {
  return {
    tags: eventIds.flatMap((eventId) => [
      eventSubmissionsTag(eventId),
      eventAgendaTag(eventId),
      eventAgendaPublishedTag(eventId),
      eventSpeakersTag(eventId),
    ]),
    revalidate: REVALIDATE.edited,
  }
}

export async function listSubmissions(
  eventId: string,
): Promise<readonly SubmissionWithParticipants[]> {
  return await listSubmissionsForEvents([eventId])
}

/**
 * Every submission across a SET of events, cast attached.
 *
 * One read for the whole set rather than `listSubmissions` in a loop, and the difference is
 * not a micro-optimisation: each of those is three whole-table scans (`Submissions`,
 * `SubmissionParticipants`, `Speakers`) under a cache key that includes the event, so
 * nothing dedupes them and a speaker in three events paid nine scans for the same rows.
 * This is the same inversion `listSpeakersInEvents` makes for the CRM, for the same reason.
 *
 * The tags are the UNION of each event's, which is what keeps the entry correct: a write to
 * any one of those events expires it. That is also why the caller has to hand over a
 * resolved list of ids and not a predicate. There is no wildcard tag, so a read that could
 * not name its events could not be invalidated, and per the project rules a cached read
 * nothing can invalidate is a bug rather than a fast path.
 */
export async function listSubmissionsForEvents(
  eventIds: readonly string[],
): Promise<readonly SubmissionWithParticipants[]> {
  if (eventIds.length === 0) return []

  const client = getClient()
  const cache = submissionsCache(eventIds)
  const wanted = new Set(eventIds)
  const submissionRecords = await client.listAll(TABLES.submissions, cache)
  const submissions = submissionRecords.map(mapSubmission).filter((row) => wanted.has(row.eventId))
  const ids = new Set(submissions.map((submission) => submission.id))
  const cast = await loadCast(client, cache, (participant) => ids.has(participant.submissionId))

  return attachParticipants(submissions, cast.participants, cast.speakers)
}

export async function getSubmission(submissionId: string): Promise<SubmissionWithParticipants> {
  const client = getClient()
  // The RECORD read is per submission, which is all this half can know: it is addressed by
  // id, so its request is unique to this submission and `submission:{id}` is the tag every
  // write to that row expires.
  const record: ReadCache = {
    tags: [submissionTag(submissionId)],
    revalidate: REVALIDATE.edited,
  }
  const submission = mapSubmission(await client.getRecord(TABLES.submissions, submissionId, record))
  // The CAST reads are event scoped, and they have to be, for two separate reasons.
  //
  // The first is about the data. `loadCast` pages the WHOLE of SubmissionParticipants and
  // the WHOLE of Speakers, and the writes that change those rows do not all name this
  // submission: `saveSpeakerProfile` expires `speaker:{id}`, `event:{id}:speakers` and
  // `event:{id}:submissions` precisely because "submission rows carry the resolved cast",
  // and `upsertSpeakerByEmail` expires the first two. Under `submission:{id}` alone, none
  // of those reached this page and a renamed speaker kept their old name on it until the
  // 60 second window lapsed.
  //
  // The second is about the cache key. A bare `listAll` puts no filter, no sort and no
  // field list on the request (client.ts `listParams`), so these two requests are
  // byte-identical to the ones `listSubmissionsForEvents` issues, and Next keys a Data
  // Cache entry on the request, never on the tags. One entry therefore serves both reads,
  // and two callers declaring DIFFERENT tags over one key is a bug in its own right: on
  // the file-system cache a reader whose tags do not match the stored ones rewrites the
  // entry with its own, without refetching, which moves `lastModified` past an expiry the
  // other caller had already recorded and hides it (next/dist/server/lib/incremental-cache
  // /file-system-cache.js). Naming the same tag set as the other caller of the same key is
  // what removes that, and it costs no extra invalidation: `submissionsCache` is a wider
  // SUBSCRIPTION, and the write side still names only the tags it affects.
  const cast = await loadCast(
    client,
    submissionsCache([submission.eventId]),
    (participant) => participant.submissionId === submissionId,
  )
  const attached = attachParticipants([submission], cast.participants, cast.speakers).at(0)

  if (attached === undefined) throw notFound(TABLES.submissions, 'id', submissionId)
  return attached
}

/**
 * Addressed by `code`, so it subscribes at event granularity and not per submission.
 *
 * `'use cache'` allowed a second `cacheTag` AFTER the read, which is how this used to
 * also carry `submission:{id}` for a row whose record id is not knowable from a code.
 * Tags on a request have to be known before it is sent, so that half is gone. Nothing
 * regresses in practice: every mutation that touches a submission row also expires the
 * event's submissions tag, which this read does carry.
 */
export async function getSubmissionByCode(
  eventId: string,
  code: string,
): Promise<SubmissionWithParticipants> {
  // `code` is an autonumber, so it is a number on the wire and a `SESS-<n>` string
  // in the app. Matching happens after the map, where both are the same shape.
  const submissions = await listSubmissions(eventId)
  const match = submissions.find((submission) => submission.code === code)
  if (match === undefined) throw notFound(TABLES.submissions, 'code', code)
  return match
}

export async function listForms(eventId: string): Promise<readonly Form[]> {
  return await listByEvent(TABLES.forms, eventId, mapForm, {
    sort: [{ field: COL.name, direction: 'asc' }],
    cache: { tags: [eventFormsTag(eventId)], revalidate: REVALIDATE.edited },
  })
}

/**
 * The public CFP form, keyed on the id in the URL.
 *
 * Tagged on `publicId` alone for the same reason `getSubmissionByCode` is tagged on the
 * event: the form's own event is only known once the record has been read, and a
 * request cannot be tagged after it has gone out. A form-builder write must therefore
 * expire `form:{publicId}` and not only `event:{id}:forms`.
 */
export async function getFormByPublicId(publicId: string): Promise<Form> {
  const record = await findByText(TABLES.forms, COL.publicId, publicId, {
    tags: [formPublicTag(publicId)],
    revalidate: REVALIDATE.edited,
  })
  if (record === undefined) throw notFound(TABLES.forms, COL.publicId, publicId)
  return mapForm(record)
}

// The identity reads that used to close this file (memberships, the two email lookups)
// live in reads-identity.ts now: they are the one group here that is mostly uncached,
// and reads.ts was over the line limit once every read declared its own tags.
