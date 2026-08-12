// ApiTokens: the bearer credentials for the public API (R10, BUILD_SPEC section 3).
//
// **This table was deliberately absent until now**, and the note at the top of
// `001-initial-schema.ts` says why: `src/services/airtable/tables.ts` carried no entry for
// it, so declaring it here would have meant this directory naming a table the registry did
// not. Both land in the same change, which is the only way that invariant survives.
//
// `name` leads because Airtable forbids a link, select, or checkbox as the primary field,
// the same constraint every other declaration in this directory works around.

import { dateTimeField, link, type TableSpec, text } from '@/migrations/schema-types'
import { COL, TABLES } from '@/services/airtable/tables'

/**
 * One issued credential.
 *
 * **No `event` link, and that absence is the design.** A token belongs to the admin user who
 * created it and reaches whatever their `EventMemberships` reach, so an organizer on three
 * events holds one token rather than three. Scoping the row to an event would put the
 * authorization in two places, and the memberships table would still be the one that decides.
 *
 * **`tokenHash` and no plaintext column.** What the base holds is a SHA-256 digest, so the
 * worst a leaked base view yields is a value that authenticates nothing. Verification hashes
 * the presented token and looks the digest up, so there is nothing to compare in constant
 * time either.
 *
 * `revokedAt` rather than deleting the row: an organizer asking "what happened on the 9th"
 * needs the token that was live then to still exist. A revoked row fails authentication on
 * the presence of this instant.
 */
const apiTokens: TableSpec = {
  name: TABLES.apiTokens,
  fields: [
    text(COL.name),
    text(COL.tokenHash),
    text(COL.scopes),
    link(COL.owner, TABLES.adminUsers),
    dateTimeField(COL.createdAt),
    dateTimeField(COL.lastUsedAt),
    dateTimeField(COL.revokedAt),
  ],
}

export const API_TABLES: readonly TableSpec[] = [apiTokens]
