// ApiTokens' own columns (R10, BUILD_SPEC section 3).
//
// Its own file for the reason `columns-cms.ts`, `columns-crm.ts` and `columns-review.ts` are:
// `tables.ts` is at its size limit, and these three names are read only by the API's mapper.
// `name`, `createdAt` and `owner` are NOT here, because they already exist in `COL` and mean
// the same things on this table. One name for one concept is the registry's whole rule.

export const COL_API = {
  /**
   * The SHA-256 hex of the bearer value, and there is deliberately no `token` column beside
   * it. The plaintext exists exactly once, in the response that created it: anyone who can
   * read the base afterwards holds a digest rather than a working credential, and a token
   * that cannot be shown again is one an organizer has to store properly the first time.
   */
  tokenHash: 'tokenHash',
  /**
   * Text rather than a multi-select, even though the values come from a fixed list. v1
   * issues exactly one scope (`read`), and widening a select later means a schema migration
   * against a base the README says has never been migrated in anger, while widening text
   * means writing a different string.
   */
  scopes: 'scopes',
  /**
   * Stamped by the API on a successful authentication, not by the settings page.
   *
   * It is what makes "which of these five tokens can I safely revoke" answerable, which is
   * the question an organizer actually has.
   *
   * **The write IS awaited on the request path**, which is the reverse of what this note used
   * to say. Fire-and-forget looked like the cheaper trade and does not survive Workers: the
   * isolate can be torn down as soon as the response is returned, so an untracked promise may
   * never run and this column then reads "never used" for a token in daily use. That is worse
   * than not having the column, because it invites revoking the wrong one. A FAILED write is
   * still swallowed, so an audit stamp can slow a request but can never fail one.
   */
  lastUsedAt: 'lastUsedAt',
  /**
   * When the token stopped working, or empty while it still does.
   *
   * Revocation is this instant rather than deleting the row, because "which token was live
   * on the 9th" is a question an organizer asks after something has already gone wrong, and
   * a deleted row cannot answer it. Authentication refuses on the presence of a value here,
   * so revoking is one field write and takes effect on the next request.
   */
  revokedAt: 'revokedAt',
} as const
