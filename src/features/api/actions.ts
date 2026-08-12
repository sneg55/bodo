'use server'

// Creating and revoking API tokens.
//
// **The plaintext is returned here and stored nowhere.** `createApiTokenAction` is the only
// place in the product where a bearer value exists as a string, and it exists for exactly as
// long as this response takes to reach the browser. That is why the UI shows it in a dialog
// the organizer has to dismiss: there is no second chance, by construction rather than by
// policy.
//
// Both actions authorize for themselves. A Server Action is reachable by POST without any
// layout rendering, so the settings page's own guard is not the boundary (BUILD_SPEC 4). The
// role required is `admin`: a reviewer must not be able to mint a credential that reads the
// whole event through a different door.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { ownsToken } from '@/features/api/auth'
import { hashToken, mintToken } from '@/features/api/token-rules'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { createApiToken, revokeApiToken } from '@/services/airtable/mutations-api'
import { findApiTokenById } from '@/services/airtable/reads-api'
import { API_SCOPES } from '@/types/api-token'

/**
 * Mint a token for the acting organizer.
 *
 * `eventId` is the event whose settings page this was pressed on, and it is used ONLY to
 * authorize. The token itself is not scoped to it: `ApiTokens` carries no event link, and
 * the reach is the owner's memberships resolved on every request (`src/features/api/auth.ts`).
 * Naming it here anyway is what stops a reviewer on event A minting a credential at all.
 */
export async function createApiTokenAction(
  eventId: string,
  name: string,
): Promise<ActionResult<{ id: string; token: string; name: string }>> {
  try {
    const { userId } = await requireEventRole(eventId, 'admin')
    const trimmed = name.trim()
    const token = mintToken()

    const created = await createApiToken({
      // A default rather than a refusal: the name is for the organizer's own benefit and an
      // empty one should not lose them the token they just asked for.
      name: trimmed === '' ? 'Untitled token' : trimmed,
      tokenHash: await hashToken(token),
      scopes: API_SCOPES,
      ownerId: userId,
      createdAt: new Date().toISOString(),
    })

    // The RECORD id, beside the plaintext, and it is not a second secret: it is what the MCP
    // setup page names when it asks whether this credential has been used yet
    // (`checkApiTokenUseAction` below), and the tokens table has been handing it to the same
    // client component for the revoke button since the day it shipped.
    return actionOk({ id: created.id, token, name: trimmed })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Revoke one of the acting organizer's OWN tokens.
 *
 * The role check is not enough on its own and used to be all there was. `ApiTokens` carries no
 * event link, so `requireEventRole(eventId, 'admin')` establishes that the caller administers
 * the event whose settings page they are on and nothing whatsoever about the row named by
 * `tokenId`: an admin of any event could kill any other organizer's credential by posting its
 * id. Ownership is therefore checked against the row itself, read FRESH, because a cached copy
 * is not something to take an authorization decision on.
 *
 * A token that does not exist and a token belonging to somebody else are refused with the same
 * error, for the same reason the API's 401 body never varies: a distinguishable refusal is a
 * way to ask which record ids are real.
 */
export async function revokeApiTokenAction(
  eventId: string,
  tokenId: string,
): Promise<ActionResult<{ revoked: true }>> {
  try {
    const { userId } = await requireEventRole(eventId, 'admin')

    const token = await findApiTokenById(tokenId)
    if (!ownsToken(token, userId)) {
      throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'that token is not yours to revoke', {
        userId,
        tokenId,
      })
    }

    await revokeApiToken(tokenId, new Date().toISOString())
    return actionOk({ revoked: true as const })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Has anything actually connected with this token yet?
 *
 * The last step of MCP setup, and the only honest one available: bodo cannot reach into an
 * organizer's client to test a config, but it can say whether a request carrying this
 * credential has ever been let in. `authenticate()` awaits the `lastUsedAt` stamp for exactly
 * this kind of question (`src/features/api/auth.ts`), and `findApiTokenById` is uncached, so
 * the answer is the current state of the row rather than a cached copy of it.
 *
 * Authorized the same way `revokeApiTokenAction` is, and for the same reason rather than by
 * imitation: `requireEventRole` establishes only that the caller administers the event whose
 * settings page this was pressed on, and `ApiTokens` carries no event link, so ownership is
 * checked against the freshly-read row. Without it, "when was this token last used" would be
 * an activity feed for every organizer's credentials, readable by id.
 *
 * A revoked token answers with its state rather than an error: selecting one is a mistake
 * this page should name, not refuse.
 */
export async function checkApiTokenUseAction(
  eventId: string,
  tokenId: string,
): Promise<ActionResult<{ lastUsedAt?: string; revokedAt?: string }>> {
  try {
    const { userId } = await requireEventRole(eventId, 'admin')

    const token = await findApiTokenById(tokenId)
    if (!ownsToken(token, userId)) {
      // Same wording and same id as an unknown token, for the same reason the revoke path
      // gives: a refusal that distinguishes them is a way to ask which record ids are real.
      throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'that token is not yours to check', {
        userId,
        tokenId,
      })
    }

    return actionOk({ lastUsedAt: token?.lastUsedAt, revokedAt: token?.revokedAt })
  } catch (error) {
    return actionFailure(error)
  }
}
