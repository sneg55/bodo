// Writes to Tracks, Tags and Rooms: the event-scoped lookup tables.
//
// One module for the three because the write is the same shape in each case (a name, an
// event link, and an `order` for the two that are ordered), and because all three are read
// through the same cache tag: `eventLookupsTag` is what `listTracks`, `listTags` and
// `listRooms` subscribe to, so a write here expires exactly that one tag and nothing else.
// A new track must not expire the abstracts table or the agenda.
//
// These are the first writes to any of the three tables. Until Event Settings, tracks, tags
// and rooms could only be created by `scripts/seed`, which is why routing and the agenda
// both had pickers over data nothing in the product could add to.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { LookupKind } from '@/features/settings/lookups'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import type { FieldSet } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import {
  eventAgendaPublishedTag,
  eventAgendaTag,
  eventLookupsTag,
  eventSubmissionsTag,
} from '@/services/airtable/tags'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'

const TABLE_FOR: ReadonlyMap<LookupKind, string> = new Map([
  ['track', TABLES.tracks],
  ['tag', TABLES.tags],
  ['room', TABLES.rooms],
])

function tableFor(kind: LookupKind): string {
  const table = TABLE_FOR.get(kind)
  if (table === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, `unknown lookup kind ${kind}`, { kind })
  }
  return table
}

export type LookupDraft = {
  kind: LookupKind
  eventId: RecordId
  name: string
  /** Tracks and rooms are ordered; tags are not, and the column does not exist on them. */
  order?: number
  color?: string
}

function lookupFields(draft: LookupDraft): FieldSet {
  return compact({
    [COL.name]: draft.name,
    [COL.event]: link(draft.eventId),
    [COL.order]: draft.kind === 'tag' ? undefined : draft.order,
    [COL.color]: draft.kind === 'room' ? undefined : draft.color,
  })
}

export async function createLookup(
  draft: LookupDraft,
  origin: WriteOrigin = 'action',
): Promise<RecordId> {
  const created = await getClient().createRecords(tableFor(draft.kind), [lookupFields(draft)])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, `${draft.kind}: write returned no record`, {
      kind: draft.kind,
    })
  }
  invalidate(origin, { own: [eventLookupsTag(draft.eventId)] })
  return record.id
}

export async function renameLookup(
  change: { kind: LookupKind; eventId: RecordId; id: RecordId; name: string },
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(tableFor(change.kind), [
    { id: change.id, fields: { [COL.name]: change.name } },
  ])
  invalidate(origin, { own: [eventLookupsTag(change.eventId)] })
}

/**
 * Delete the row outright rather than soft deleting it.
 *
 * Airtable clears the link on every submission that pointed at it, which is the honest
 * outcome: an accepted session whose track was removed has no track, and the caller has
 * already told the organizer how many submissions that affects.
 *
 * That is also why this is the one write here that expires more than the lookups tag. The
 * submission ROWS change as a side effect of the delete, so the abstracts list and, for a
 * room, the agenda are both holding values the base no longer has. Create and rename touch
 * no submission and expire nothing extra.
 */
export async function deleteLookup(
  change: { kind: LookupKind; eventId: RecordId; id: RecordId },
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().deleteRecords(tableFor(change.kind), [change.id])
  invalidate(origin, {
    own: [eventLookupsTag(change.eventId), eventSubmissionsTag(change.eventId)],
    others:
      change.kind === 'room'
        ? [eventAgendaTag(change.eventId), eventAgendaPublishedTag(change.eventId)]
        : [],
  })
}
