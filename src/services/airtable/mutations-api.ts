// Writes to ApiTokens (R10).
//
// Only the DIGEST is ever written. The plaintext is minted above this layer and returned to
// the organizer once; nothing here has ever seen it, which is what makes "bodo cannot show
// you that token again" a fact about the code rather than a policy.
//
// Two of the three writes name `apiTokensTag`, and `touchApiToken` deliberately does not.
// See its own note: an audit stamp that expired the settings list would make every API
// request invalidate a cache entry it did not meaningfully change.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapApiToken } from '@/services/airtable/mapping-api'
import { COL, TABLES } from '@/services/airtable/tables'
import { apiTokensTag } from '@/services/airtable/tags'
import type { ApiScope, ApiToken } from '@/types/api-token'

export type ApiTokenDraft = {
  readonly name: string
  readonly tokenHash: string
  readonly scopes: readonly ApiScope[]
  readonly ownerId: string
  readonly createdAt: string
}

export async function createApiToken(
  draft: ApiTokenDraft,
  origin: WriteOrigin = 'action',
): Promise<ApiToken> {
  const created = await getClient().createRecords(TABLES.apiTokens, [
    {
      [COL.name]: draft.name,
      [COL.tokenHash]: draft.tokenHash,
      [COL.scopes]: draft.scopes.join(','),
      [COL.owner]: [draft.ownerId],
      [COL.createdAt]: draft.createdAt,
    },
  ])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'ApiTokens: write returned no record', {
      table: TABLES.apiTokens,
      name: draft.name,
    })
  }
  invalidate(origin, { own: [apiTokensTag()] })
  return mapApiToken(record)
}

/**
 * Stop a token working, keeping the row.
 *
 * Deleting instead would take the answer to "which credential was live when this happened"
 * away at exactly the moment somebody needs it, which is usually right after revoking one.
 */
export async function revokeApiToken(
  tokenId: string,
  revokedAt: string,
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(TABLES.apiTokens, [
    { id: tokenId, fields: { [COL.revokedAt]: revokedAt } },
  ])
  invalidate(origin, { own: [apiTokensTag()] })
}

/**
 * Stamp `lastUsedAt` after a successful authentication.
 *
 * **Invalidates nothing, on purpose.** The only reader of this column is the settings table,
 * where a slightly stale "last used" is worth less than making every authenticated API
 * request expire a cache entry for every organizer looking at that page.
 *
 * **It IS awaited on the request path** (`src/features/api/auth.ts`), which is the reverse of
 * what this note used to say. Fire-and-forget was the cheaper trade on paper, and it does not
 * survive Workers: the isolate can be torn down as soon as the response is returned, so an
 * untracked promise may never run and the column then reads "never used" for a token that is
 * in daily use. That is worse than having no column, because the whole point of it is telling
 * an organizer which credential is safe to revoke. The caller still swallows a REJECTION, so
 * an audit write can slow a request but can never fail one.
 */
export async function touchApiToken(tokenId: string, at: string): Promise<void> {
  await getClient().updateRecords(TABLES.apiTokens, [
    { id: tokenId, fields: { [COL.lastUsedAt]: at } },
  ])
}
