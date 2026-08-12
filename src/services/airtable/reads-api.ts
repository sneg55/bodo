// Reads for ApiTokens (R10).
//
// **`findApiToken` is UNCACHED, and that is the security property.** It is the read that
// decides whether a request is authenticated, so a cached answer means a revoked token keeps
// working until the window lapses. The rest of the DAL caches aggressively because a stale
// list is a cosmetic problem; a stale credential is not. This follows the same rule the
// speaker upsert and the outbox due-list already state in `read-cache.ts`.
//
// `findApiTokenById` is uncached for the same reason in the other direction: it is read to
// decide whether a WRITE is allowed, and an authorization decision taken on a minute-old copy
// of a row is not an authorization decision.
//
// The list read, by contrast, is only ever rendered on a settings page and can be cached: a
// token that appears a minute late in a table costs nobody anything. What it may NOT do is
// answer with somebody else's rows, which is what `ownerId` is for.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { mapApiToken } from '@/services/airtable/mapping-api'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { findByText } from '@/services/airtable/reads'
import { COL, TABLES } from '@/services/airtable/tables'
import { apiTokensTag } from '@/services/airtable/tags'
import type { ApiToken } from '@/types/api-token'

/**
 * The token whose digest matches, or `undefined`.
 *
 * Takes the HASH rather than the presented value, so the plaintext never reaches the DAL
 * and cannot end up in a query string, a log line, or an Airtable formula. The caller in
 * `src/features/api/auth.ts` does the hashing.
 *
 * Revocation is NOT filtered here. The caller checks `revokedAt`, because "this token was
 * revoked" and "this token never existed" are the same answer to a client and different
 * answers to us.
 */
export async function findApiToken(tokenHash: string): Promise<ApiToken | undefined> {
  const record = await findByText(TABLES.apiTokens, COL.tokenHash, tokenHash)
  return record === undefined ? undefined : mapApiToken(record)
}

/**
 * One token by record id, fresh, or `undefined` when there is no such row.
 *
 * For the revoke path, which has to compare `ownerId` against the acting user before it
 * writes. Only a 404 becomes `undefined`: a network failure or a permissions error is a fault
 * and is re-thrown, because swallowing it here would turn "Airtable is down" into "that token
 * is not yours", which is a refusal nobody can debug.
 */
export async function findApiTokenById(tokenId: string): Promise<ApiToken | undefined> {
  try {
    return mapApiToken(await getClient().getRecord(TABLES.apiTokens, tokenId))
  } catch (error) {
    if (isAppError(error) && error.id === ErrorIds.DATA_RECORD_NOT_FOUND) return undefined
    throw error
  }
}

/**
 * The tokens `ownerId` issued, newest first, including revoked ones.
 *
 * **Scoped to one owner, and that scoping is the whole point of the parameter.** This used to
 * answer with every row in the base, and the settings page above it checks only that the
 * viewer administers the event in the URL. Since `ApiTokens` carries no event link at all,
 * that check says nothing about the rows: any organizer of any event saw, and could revoke,
 * every other organizer's credentials. The filter is in code rather than in a formula for the
 * usual reason (`reads.ts`): `Owner` is a linked record, which a formula sees as its primary
 * field's text.
 */
export async function listApiTokens(ownerId: string): Promise<readonly ApiToken[]> {
  const records = await getClient().listAll(TABLES.apiTokens, {
    tags: [apiTokensTag()],
    revalidate: REVALIDATE.lookup,
  })
  return records
    .map(mapApiToken)
    .filter((token) => token.ownerId === ownerId)
    .toSorted((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}
