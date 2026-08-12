// What an issued API credential looks like above the DAL (R10).
//
// **There is no `token` field here, and there never can be.** The plaintext is returned
// exactly once, by the action that mints it, as its own value; everything that later READS a
// token reads this shape, which carries only the digest. That is what makes "show it again"
// impossible rather than merely discouraged.

/** The scopes v1 issues. Read-only, deliberately: see `src/features/api/tokens.ts`. */
export const API_SCOPES = ['read'] as const

export type ApiScope = (typeof API_SCOPES)[number]

export type ApiToken = {
  readonly id: string
  /** What the organizer called it, so a list of five is a list of five distinct things. */
  readonly name: string
  /** SHA-256 hex of the bearer value. Never the value. */
  readonly tokenHash: string
  readonly scopes: readonly ApiScope[]
  /** The admin user who created it. Their memberships decide what it reaches. */
  readonly ownerId: string | undefined
  readonly createdAt: string | undefined
  /** Stamped on a successful authentication, best-effort and never awaited. */
  readonly lastUsedAt: string | undefined
  /** Present once revoked. A token with a value here authenticates nothing. */
  readonly revokedAt: string | undefined
}

/**
 * A token as the settings page shows it: no digest, because the page has no use for one and
 * a hash on screen invites somebody to treat it as a credential.
 */
export type ApiTokenRow = Omit<ApiToken, 'tokenHash'>
