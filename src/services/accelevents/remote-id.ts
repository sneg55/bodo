// The `accelevents:` namespace on `IntegrationMappings.remoteId`.
//
// One table holds every provider's remote ids, keyed on (event, entityType, localId).
// §5.0e namespaces the two importers' ids by source (`sessionize:14022`,
// `sessionboard:<uuid>`) so two providers cannot collide on the same integer, and
// Accelevents' rows were written bare. That exception is not cosmetic: the retry sweep
// matches a mapping on the identity key ALONE, so an event imported from Sessionize
// would hand the Accelevents push a Sessionize id and the next sweep would PUT that id
// against somebody else's API. Prefixing here is what makes the namespace total.
//
// Backward compatibility is handled by reading tolerantly and writing prefixed, rather
// than by a migration:
//
//   - Write: always `accelevents:<id>`. `saveIntegrationMapping` is the only writer.
//   - Read:  a value carrying ANOTHER known source's prefix is not ours, and the
//     Accelevents reads drop it. A value carrying no known prefix is a legacy row this
//     code wrote before the namespace existed, so it is accepted as Accelevents. That
//     is safe in exactly one direction and only because of the ordering: no importer
//     has ever written this table (§5.0e is unbuilt), so nothing bare can be anyone
//     else's, and every importer namespaces from its first row.
//
// A migration was the alternative and it was rejected: rewriting live mapping rows to
// gain a prefix risks losing the remote id that is the only link to the far side, for a
// property this file can derive at read time for free.

import type { ImportSource } from '@/types/imports'
import { IMPORT_SOURCES } from '@/types/imports'

/**
 * Typed as `ImportSource` on purpose. The prefix and the registry/import id are the
 * same string by design, so a rename of the source vocabulary fails to compile here
 * instead of silently orphaning every mapping row this file ever wrote.
 */
export const ACCEL_REMOTE_ID_PREFIX: ImportSource = 'accelevents'

const SEPARATOR = ':'

/** What goes in the column. Idempotent, so a re-save never double-prefixes. */
export function toNamespacedRemoteId(remoteId: string): string {
  if (namespaceOf(remoteId) === ACCEL_REMOTE_ID_PREFIX) return remoteId
  return `${ACCEL_REMOTE_ID_PREFIX}${SEPARATOR}${remoteId}`
}

/**
 * The bare Accelevents id a REST path can be built from, or `undefined` when the row
 * belongs to another provider.
 *
 * `undefined` rather than a throw: a Sessionize mapping sitting next to an Accelevents
 * one is normal data, not corruption, and the caller's correct response is to skip the
 * row rather than to abandon the sweep.
 */
export function fromNamespacedRemoteId(stored: string): string | undefined {
  const namespace = namespaceOf(stored)
  if (namespace === undefined) return stored
  if (namespace !== ACCEL_REMOTE_ID_PREFIX) return undefined
  return stored.slice(ACCEL_REMOTE_ID_PREFIX.length + SEPARATOR.length)
}

/**
 * The source a stored id is namespaced to, or `undefined` for a bare value.
 *
 * Only the three known sources count as a namespace. A remote id that happens to
 * contain a colon (nothing in the Accelevents docs produces one, but their ids are
 * opaque and this code does not get to assume) is therefore read as a bare id rather
 * than as an unknown provider's row that gets silently dropped.
 */
export function namespaceOf(stored: string): ImportSource | undefined {
  return IMPORT_SOURCES.find((source) => stored.startsWith(`${source}${SEPARATOR}`))
}
