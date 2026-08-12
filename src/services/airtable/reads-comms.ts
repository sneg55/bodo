// Live reads for EmailTemplates. BUILD_SPEC 3 and 5.3.
//
// This is the reader that section 5.3 assumed and that did not exist: until now every
// system email body was a template in code, and `EmailOutbox.templateSource` could only
// ever be `system`. `@/features/comms/resolve-template` is what consumes these rows, and
// `@/features/comms/template-write` is what writes them.
//
// The table is keyed by a LINK to Events, so the "filter in code, not in a formula" rule
// at the top of reads.ts applies: an Airtable formula sees a linked record as its primary
// field's TEXT, so `{event} = 'recABC'` matches nothing at all. `listByEvent` pages the
// table to completion and compares the mapped `eventId`.
//
// The cached/uncached split here is the one reads-resources.ts explains, with the two
// halves swapped round in importance:
//
//   - The CACHED read is what the senders and the builder panel use. A trigger resolving a
//     body per recipient must not cost one Airtable round trip per email, and the window
//     is safe because a body is snapshotted into `payloadJson` at enqueue time anyway
//     (to-fields-portal.ts): a template edited mid-batch cannot change mail already
//     promised, so serving a 60-second-old body is the same class of staleness the outbox
//     already has by design.
//   - The UNCACHED read is for the WRITE path only. `upsertEmailTemplate` decides between
//     create and update from it, and a cached answer there writes a second row for a key
//     that already exists, which is how one event ends up with two `custom-admin-new`
//     templates and the sender picks whichever the pagination returns first.

import { mapEmailTemplate } from '@/services/airtable/mapping-comms'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { listByEvent } from '@/services/airtable/reads'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventEmailTemplatesTag } from '@/services/airtable/tags'
import type { EmailTemplate, RecordId } from '@/types/domain'

/**
 * Tags AND a window, together. Either alone is a bug the conventions file names: a tagged
 * read with no window is not cached at all, so its tags invalidate nothing, and a cached
 * read with no tag can never be expired by the save that changed it.
 *
 * `REVALIDATE.edited` (60s) rather than `lookup` (3600s), because this is squarely
 * "anything an organizer edits and then looks at": the builder panel reads it back
 * immediately after saving. The save expires the tag, so the window only ever covers a row
 * edited in the Airtable grid directly.
 */
function templatesCache(eventId: RecordId): ReadCache {
  return { tags: [eventEmailTemplatesTag(eventId)], revalidate: REVALIDATE.edited }
}

/**
 * A row with no `key` is dropped rather than returned.
 *
 * Not defensive padding: `+` in the Airtable grid creates a blank row, and this is a table
 * an organizer opens by hand. A keyless row cannot be addressed by a sender or by the
 * builder panel, so it is not a template yet, and letting one through would make
 * `findEmailTemplate` able to return a row whose body is empty and whose key matches
 * nothing. mapping-comms.ts explains why the mapper tolerates it instead of raising.
 */
function keyed(rows: readonly EmailTemplate[]): readonly EmailTemplate[] {
  return rows.filter((row) => row.key !== '')
}

/** Every template on the event, cached and tagged. Read by the senders and the builder. */
export async function listEmailTemplates(eventId: RecordId): Promise<readonly EmailTemplate[]> {
  return keyed(
    await listByEvent(TABLES.emailTemplates, eventId, mapEmailTemplate, {
      // Sorted by key so two rows sharing one key (which the writer prevents but the
      // Airtable grid does not) resolve to the same one on every read rather than to
      // whichever the pagination happened to return first.
      sort: [{ field: COL.key, direction: 'asc' }],
      cache: templatesCache(eventId),
    }),
  )
}

/**
 * One template by key, or `undefined` when the event has none.
 *
 * Absence is an ordinary answer, not a failure: it means "this trigger sends its code
 * default", which is the state every event is in until an organizer saves a template.
 * `resolveTemplate` is what turns that into a body and a `templateSource`.
 */
export async function findEmailTemplate(
  eventId: RecordId,
  key: string,
): Promise<EmailTemplate | undefined> {
  return (await listEmailTemplates(eventId)).find((row) => row.key === key)
}

/**
 * Every template on the event, UNCACHED, for the write path.
 *
 * `upsertEmailTemplate` decides create-versus-update from this. See the header for why a
 * cached answer here duplicates a row.
 */
export async function listEmailTemplatesUncached(
  eventId: RecordId,
): Promise<readonly EmailTemplate[]> {
  return keyed(
    await listByEvent(TABLES.emailTemplates, eventId, mapEmailTemplate, {
      // No `cache` key at all, which `cacheInit` turns into an explicit `no-store`.
      sort: [{ field: COL.key, direction: 'asc' }],
    }),
  )
}
