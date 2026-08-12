// Who the submitter's address already is, resolved once, before anything is written.
//
// Two questions are answered by the same uncached read, which is the whole reason this is
// one function rather than two:
//
//   1. How many submissions this address already has against this form, for the per-user cap
//      (BUILD_SPEC 5.1, drafts included).
//   2. WHICH Speakers row it is, so `submitterBinding` can decide whether an anonymous POST
//      may attach itself to a record that already exists. See
//      @/features/auth/submitter-identity for the hole that closes.
//
// The count used to be resolved on its own and the row thrown away, so the identity check
// added below would have cost a second `findSpeakerByEmail` on every submit for a fact the
// first call already had in its hand.
//
// Read through `findSpeakerByEmail` rather than by upserting first, so a submitter who is
// already at their cap, or who cannot prove the address, does not get a Speakers row created
// for a submission that is about to be refused. Uncached for the reason every
// decides-a-write read in this codebase is uncached: a stale answer here creates a duplicate
// person or waves through a bind that should have been refused.

import { authSecret } from '@/features/auth/secret'
import {
  DRAFT_CLAIM_TTL_MS,
  mintDraftClaim,
  verifyDraftClaim,
} from '@/features/auth/submitter-identity'
import { findSpeakerByEmail, listSubmissions } from '@/services/airtable/queries'
import type { RecordId, Speaker, Submission } from '@/types/domain'

export type SubmitterContext = {
  /** The row this address already names, or `undefined` when it names none. */
  existing?: Speaker
  /** Submissions this address already has against this form. Drafts count. */
  count: number
  /**
   * The unsubmitted draft this address has against this form, if there is one.
   *
   * Answered here because the two reads above already have it in hand, and the submit needs
   * it for two things at once: it PROMOTES that row rather than filing a second one
   * (./draft-promote.ts), and the cap must stop counting the row against the submit that is
   * promoting it. Keyed identically to `findOwnDraft` in ./draft-write.ts, which is the same
   * question asked on the save path.
   */
  draft?: Submission
}

export async function submitterContext(input: {
  email: string
  eventId: RecordId
  formId: RecordId
}): Promise<SubmitterContext> {
  const existing = await findSpeakerByEmail(input.email.trim().toLowerCase())
  if (existing === undefined) return { count: 0 }

  const submissions = await listSubmissions(input.eventId)
  const own = submissions.filter(
    (row) => row.submitterId === existing.id && row.formId === input.formId,
  )

  return { existing, count: own.length, draft: own.find((row) => row.status === 'draft') }
}

// ── The draft claim cookie ───────────────────────────────────────────────────
//
// The credential itself is minted and verified in `@/features/auth/submitter-identity`,
// which stays pure. This is the half that touches the request: one cookie, read by both
// public entry points and written by exactly one of them.
//
// `cookies()` is imported dynamically inside each function, exactly as session.ts does it
// and for the same reason: it throws outside a request scope, and importing it at module
// scope would make this file unimportable from a unit test.

export const DRAFT_CLAIM_COOKIE = 'bodo_draft_claim'

/**
 * The speaker id this browser holds a live draft claim for, or undefined.
 *
 * Swallows everything. This runs on a PUBLIC form that a visitor with no cookie at all must
 * still be able to use, so a missing store, a stale cookie and a forged one are the same
 * answer, and that answer costs nothing but the shortcut.
 */
export async function readDraftClaim(): Promise<RecordId | undefined> {
  try {
    const { cookies } = await import('next/headers')
    const store = await cookies()
    return await verifyDraftClaim({
      token: store.get(DRAFT_CLAIM_COOKIE)?.value,
      nowMs: Date.now(),
      secret: authSecret(),
    })
  } catch {
    return undefined
  }
}

/**
 * Hand this browser the claim for a record the public form has just created for it.
 *
 * ONLY ever called on the `create` branch, or to refresh a claim the same browser already
 * presented for the same record. Calling it anywhere else would turn it into a way to mint
 * proof of a record that existed first, which is precisely what `submitterBinding` refuses.
 *
 * `httpOnly` so no script on the page can read it back, `sameSite: 'lax'` and `secure` for
 * the reasons `sessionCookieAttributes` states. It is not a session and grants no portal
 * access: `submitterBinding` is the only reader.
 */
export async function grantDraftClaim(speakerId: RecordId): Promise<void> {
  const nowMs = Date.now()
  const token = await mintDraftClaim({ speakerId, nowMs, secret: authSecret() })
  const { cookies } = await import('next/headers')
  const store = await cookies()
  store.set(DRAFT_CLAIM_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(DRAFT_CLAIM_TTL_MS / 1000),
    expires: new Date(nowMs + DRAFT_CLAIM_TTL_MS),
  })
}
