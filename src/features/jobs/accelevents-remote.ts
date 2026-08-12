// Which Accelevents call a failed row's replay actually is.
//
// Split from accelevents-sync.ts, which owns the sweep: what order the backlog runs in,
// what is claimed, what is counted. This file owns the narrower question of, given one
// snapshotted row and an action, which method on the client to call and with what. Keeping
// them apart matters because the two change for different reasons: the sweep changes when
// the retry policy does, and this changes when the remote API does.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import type { AccelClient, RemoteRef } from '@/services/accelevents/client'
import type {
  FailedSyncRow,
  IntegrationMapping,
  SyncAction,
} from '@/services/accelevents/sync-types'

export type RemoteAction = Exclude<SyncAction, 'skip'>

export type RemoteRetry = {
  row: FailedSyncRow
  mapping: IntegrationMapping | undefined
  action: RemoteAction
  eventUrl: string
  client: AccelClient
}

/**
 * Whether this replay is a create or an update.
 *
 * A mapping means the entity already exists remotely, so it is an update whatever the
 * original attempt was: a create that failed AFTER the remote accepted it leaves exactly
 * that state, and repeating the create would duplicate the entity.
 *
 * A remote id ON THE ROW says the same thing with no mapping to back it. That is the state
 * a create leaves when the remote accepted it and the mapping write then failed, and
 * `pushEntity` now records the returned id on the failed row for exactly this reason. It
 * used to record nothing there, so the row looked like a create that never reached the far
 * side and this function sent a second one. `existingRemoteId` below falls back to the
 * same value, so the update has an id to address.
 */
export function chooseRemoteAction(
  row: FailedSyncRow,
  mapping: IntegrationMapping | undefined,
): RemoteAction {
  if (mapping !== undefined) return 'update'
  if (row.remoteId !== undefined) return 'update'
  if (row.action === 'update') return 'update'
  if (row.action === 'create') return 'create'
  throw new AppError(ErrorIds.DATA_SHAPE_INVALID, 'a failed skip has no accepted mapping', {
    syncLogId: row.id,
  })
}

export async function retryRemote(retry: RemoteRetry): Promise<RemoteRef> {
  const { row, mapping, action, eventUrl, client } = retry
  if (row.entityType === 'speaker') {
    if (action === 'create') return await createSpeaker(row, eventUrl, client)
    return await client.updateSpeaker(eventUrl, existingRemoteId(row, mapping), row.payload)
  }
  if (row.entityType === 'submission') {
    if (action === 'create') return await client.createSession(eventUrl, row.payload)
    return await client.updateSession(eventUrl, existingRemoteId(row, mapping), row.payload)
  }
  if (action === 'create') return await client.createTaxonomy(eventUrl, row.payload)

  // A taxonomy "update" is TWO different states, and only one of them ever needed a call.
  //
  //   1. No mapping, but the row carries a remote id. The create reached Accelevents, they
  //      accepted it and answered with that id, and only the `IntegrationMappings` write
  //      failed. The remote record already matches `row.payload`, whose hash is
  //      `row.requestHash`, so the mapping the sweep writes next is exactly right and
  //      nothing has to be sent. This used to fall into the throw below, so a track or tag
  //      in that state produced a failed attempt on EVERY sweep forever and never got its
  //      mapping back. `existed: true` because the record is theirs already, not new.
  //   2. A mapping exists and the hash has moved, which is a genuine RENAME. That one does
  //      need a call and there is no endpoint for it: `AccelClient` exposes
  //      `createTaxonomy` and nothing else (client.ts), and sending the create again would
  //      duplicate the remote tag. It stays a visible failed attempt, and this is a BOUND
  //      rather than a fix: a renamed track never reaches Accelevents, and the failed row
  //      is re-attempted by every sweep until the endpoint exists or somebody clears it.
  if (mapping === undefined) return { remoteId: existingRemoteId(row, mapping), existed: true }

  throw new AppError(ErrorIds.ACCEL_BAD_REQUEST, 'taxonomy update is not in the client contract', {
    entityType: row.entityType,
    localId: row.localId,
  })
}

/**
 * A speaker create that collides on email is a success, not a failure.
 *
 * Accelevents rejects a duplicate address with its own error, and the speaker it is
 * complaining about is the one we want a mapping for, so the collision is resolved to that
 * remote id rather than reported. Without this a speaker who exists remotely can never be
 * mapped, and every sweep retries the same create forever.
 */
async function createSpeaker(
  row: Extract<FailedSyncRow, { entityType: 'speaker' }>,
  eventUrl: string,
  client: AccelClient,
): Promise<RemoteRef> {
  try {
    return await client.createSpeaker(eventUrl, row.payload)
  } catch (error) {
    if (!isAppError(error) || error.id !== ErrorIds.ACCEL_DUPLICATE_EMAIL) throw error

    const remoteId = await client.findSpeakerByEmail(eventUrl, row.payload.email)
    if (remoteId === undefined) {
      // The API said the email exists and then could not find it. Guessing here would
      // write a mapping to nothing.
      throw new AppError(
        ErrorIds.ACCEL_BAD_REQUEST,
        'duplicate speaker email could not be resolved to a remote id',
        { eventUrl, email: row.payload.email },
      )
    }
    return { remoteId, existed: true }
  }
}

function existingRemoteId(row: FailedSyncRow, mapping: IntegrationMapping | undefined): string {
  const remoteId = mapping?.remoteId ?? row.remoteId
  if (remoteId !== undefined) return remoteId
  throw new AppError(ErrorIds.DATA_SHAPE_INVALID, 'Accelevents update has no remote id', {
    syncLogId: row.id,
    localId: row.localId,
  })
}
