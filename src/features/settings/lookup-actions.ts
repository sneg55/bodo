'use server'

// Library > Tags writes: add, rename and remove a track, tag or room.
//
// Each one authorizes for itself with `requireEventRole(eventId, 'admin')`, and each one
// re-reads the event's own list before writing. That re-read is the ownership check, not a
// convenience: a record id arriving in an action is client input, so renaming by id alone
// would let an admin on one event rename another event's track.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import {
  checkLookupName,
  type LookupEntry,
  type LookupKind,
  lookupLabel,
  nextLookupOrder,
} from '@/features/settings/lookups'
import { createLookup, deleteLookup, renameLookup } from '@/services/airtable/mutations-lookups'
import { listRooms, listTags, listTracks } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

/** The event's current rows for one kind, with the `order` values a new row appends past. */
async function readLookups(
  kind: LookupKind,
  eventId: RecordId,
): Promise<{ entries: readonly LookupEntry[]; orders: readonly number[] }> {
  if (kind === 'tag') {
    const tags = await listTags(eventId)
    return { entries: tags.map((tag) => ({ id: tag.id, name: tag.name })), orders: [] }
  }
  if (kind === 'room') {
    const rooms = await listRooms(eventId)
    return {
      entries: rooms.map((room) => ({ id: room.id, name: room.name })),
      orders: rooms.map((room) => room.order),
    }
  }
  const tracks = await listTracks(eventId)
  return {
    entries: tracks.map((track) => ({ id: track.id, name: track.name })),
    orders: tracks.map((track) => track.order),
  }
}

function refuse(message: string, context: Record<string, unknown>): AppError {
  return new AppError(ErrorIds.DATA_WRITE_FAIL, message, context)
}

export async function addLookupAction(input: {
  eventId: RecordId
  kind: LookupKind
  name: string
}): Promise<ActionResult<{ id: RecordId; name: string }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const { entries, orders } = await readLookups(input.kind, input.eventId)

    const problem = checkLookupName(input.kind, input.name, entries)
    if (problem !== undefined) throw refuse(problem.message, input)

    const name = input.name.trim()
    const id = await createLookup({
      kind: input.kind,
      eventId: input.eventId,
      name,
      order: input.kind === 'tag' ? undefined : nextLookupOrder(orders),
    })
    return actionOk({ id, name })
  } catch (error) {
    return actionFailure(error)
  }
}

export async function renameLookupAction(input: {
  eventId: RecordId
  kind: LookupKind
  id: RecordId
  name: string
}): Promise<ActionResult<{ name: string }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const { entries } = await readLookups(input.kind, input.eventId)
    assertOwned(entries, input)

    const problem = checkLookupName(input.kind, input.name, entries, input.id)
    if (problem !== undefined) throw refuse(problem.message, input)

    const name = input.name.trim()
    await renameLookup({ kind: input.kind, eventId: input.eventId, id: input.id, name })
    return actionOk({ name })
  } catch (error) {
    return actionFailure(error)
  }
}

export async function removeLookupAction(input: {
  eventId: RecordId
  kind: LookupKind
  id: RecordId
}): Promise<ActionResult<{ id: RecordId }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const { entries } = await readLookups(input.kind, input.eventId)
    assertOwned(entries, input)

    await deleteLookup({ kind: input.kind, eventId: input.eventId, id: input.id })
    return actionOk({ id: input.id })
  } catch (error) {
    return actionFailure(error)
  }
}

function assertOwned(
  entries: readonly LookupEntry[],
  input: { kind: LookupKind; id: RecordId; eventId: RecordId },
): void {
  if (entries.some((entry) => entry.id === input.id)) return
  throw new AppError(
    ErrorIds.DATA_RECORD_NOT_FOUND,
    `that ${lookupLabel(input.kind).singular.toLowerCase()} is not on this event`,
    input,
  )
}
