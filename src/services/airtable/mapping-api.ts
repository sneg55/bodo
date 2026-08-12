// Mapper for ApiTokens. BUILD_SPEC section 3, R10.
//
// `scopes` is stored as text and read as a list, splitting on commas, because the column is
// text for the reason `columns-api.ts` gives. Unknown scope strings are DROPPED rather than
// throwing: a token row is a credential, and the failure mode of a strict read here is that
// a typo in the base takes the whole API offline for that caller. Dropping narrows what the
// token can do, which is the safe direction.

import {
  type AirtableRecord,
  optionalLink,
  optionalText,
  text,
  view,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { API_SCOPES, type ApiScope, type ApiToken } from '@/types/api-token'

export function mapApiToken(record: AirtableRecord): ApiToken {
  const source = view(TABLES.apiTokens, record)
  return {
    id: source.id,
    // Required: the name is how an organizer tells one row from another when deciding
    // which to revoke, and an unnamed credential is one nobody dares touch.
    name: text(source, COL.name),
    tokenHash: text(source, COL.tokenHash),
    scopes: parseScopes(optionalText(source, COL.scopes)),
    ownerId: optionalLink(source, COL.owner),
    createdAt: optionalText(source, COL.createdAt),
    lastUsedAt: optionalText(source, COL.lastUsedAt),
    revokedAt: optionalText(source, COL.revokedAt),
  }
}

/**
 * `read,write` to `['read']` today, because `write` is not a scope v1 issues.
 *
 * Narrowing rather than rejecting is the deliberate direction: a value this does not
 * recognise grants nothing, so an unknown string in the base cannot widen a token's reach,
 * and a token whose scopes all fail to parse simply authorizes nothing.
 */
function parseScopes(raw: string | undefined): readonly ApiScope[] {
  if (raw === undefined) return []
  const known = new Set<string>(API_SCOPES)
  return raw
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope): scope is ApiScope => known.has(scope))
}
