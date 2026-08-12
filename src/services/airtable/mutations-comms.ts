// Writes for EmailTemplates. BUILD_SPEC 3 and 5.3.
//
// Same posture as the rest of the write side: no fixture branch, and `getClient()` throws
// CFG_ENV_MISSING with no base configured, because a template editor that reports success
// and stores nothing is worse than one that fails. The organizer would find out from a
// speaker who received the old body.
//
// One function, and it is an upsert on `(event, key)` rather than a create.
//
// It is a read-then-write and NOT `client.upsertRecords`, which is the difference from
// `enqueueEmails`. Airtable merges on field VALUES, and `key` is not unique on this table:
// two events both have a `custom-admin-new` row, so merging on `key` alone would let event
// A's save land on event B's template. Merging on `[key, event]` is not available either,
// because a linked record's merge value is its primary field's TEXT, so the match would be
// on the event's NAME and would break the day somebody renames the event. That is the same
// trap reads-comms.ts records for `filterByFormula`, and it is why mutations-review.ts
// read-then-writes too.
//
// The read is therefore the uncached one. A cached list here writes a second row for a key
// that already exists, and the sender then picks whichever row pagination returns first,
// which is a body an organizer edited once and can no longer find.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapEmailTemplate } from '@/services/airtable/mapping-comms'
import { listEmailTemplatesUncached } from '@/services/airtable/reads-comms'
import { TABLES } from '@/services/airtable/tables'
import { eventEmailTemplatesTag } from '@/services/airtable/tags'
import {
  type EmailTemplateEdit,
  emailTemplateEditFields,
  emailTemplateFields,
} from '@/services/airtable/to-fields-comms'
import type { EmailTemplate, RecordId } from '@/types/domain'

/**
 * Create or update the one row for this event and key, and hand it back.
 *
 * `eventId` is the caller's, already authorized (`@/features/comms/template-write` is the
 * only caller and it authorizes first). It is used to SCOPE the lookup as well as to create
 * the link, which is what stops an admin of event A from editing event B's template: the
 * row is found in A's own list or it is created under A, and there is no path that takes a
 * record id from the client at all.
 */
export async function upsertEmailTemplate(
  input: { eventId: RecordId; edit: EmailTemplateEdit },
  origin: WriteOrigin,
): Promise<EmailTemplate> {
  const client = getClient()
  const existing = (await listEmailTemplatesUncached(input.eventId)).find(
    (row) => row.key === input.edit.key,
  )

  try {
    if (existing !== undefined) {
      const updated = await client.updateRecords(TABLES.emailTemplates, [
        { id: existing.id, fields: emailTemplateEditFields(input.edit) },
      ])
      return mapped(updated.at(0), input.edit.key)
    }

    const created = await client.createRecords(TABLES.emailTemplates, [
      emailTemplateFields({ eventId: input.eventId, ...input.edit }),
    ])
    return mapped(created.at(0), input.edit.key)
  } finally {
    // `finally`, for the reason `updateResource` gives: a write that failed after Airtable
    // accepted it is still a change, and leaving the cache holding the pre-write snapshot
    // is how the next reader sees a body that no longer exists in the base.
    //
    // `own` only. The rows an organizer edits are read back by this same builder panel and
    // by the triggers, and a trigger reads at send time rather than off a screen somebody
    // is looking at, so there is no other surface to expire. Mail already queued is not
    // affected at all: `payloadJson` snapshots the body at enqueue time.
    invalidate(origin, { own: [eventEmailTemplatesTag(input.eventId)] })
  }
}

function mapped(record: Parameters<typeof mapEmailTemplate>[0] | undefined, key: string) {
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'EmailTemplates: write returned no record', {
      table: TABLES.emailTemplates,
      key,
    })
  }
  return mapEmailTemplate(record)
}
