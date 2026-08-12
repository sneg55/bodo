// May this public submission attach itself to a Speakers row that ALREADY EXISTS?
//
// THE HOLE. The public CFP takes an email address on step 2 and nothing else: no password,
// no verification, by design (see the header of the wizard's AccountStep, and BUILD_SPEC
// section 4, which is passwordless). `submitCfp` then calls `upsertSpeakerByEmail` for every
// participant, which does `findByText(TABLES.speakers, COL.email, ...)` and, when it finds a
// row, UPDATES it and links the submission to it. So an anonymous visitor who types a known
// speaker's address gets two things nobody granted them:
//
//   1. the submission is filed under that speaker's record, which is what the organizer's
//      Abstracts table, the reviewer queue and that speaker's own portal all read from;
//   2. `speakerFields` writes `firstName`, `lastName`, and any bio, company, phone or
//      headshot answer the form collected, over the existing values (blank answers are
//      dropped by `speakerDraftFor`, so this overwrites rather than clears).
//
// The CFP-02 evaluation reproduced (1) with two throwaway addresses. (2) is the same POST
// with the profile questions filled in, and is verified by reading `speakerFields` in
// to-fields.ts: `blank(draft.firstName)` is written whenever the draft carries one, and the
// wizard requires a first and last name to advance.
//
// THE OTHER WAY IN, closed on 2026-08-11 and worth stating because this check did not move.
// Everything below is decided about ONE address, the Account step's, and (1) above was
// reached through a different field entirely: the participant list. `primarySpeaker` used to
// pick whichever participant carried `isPrimary` and `createSubmission` filed the row under
// them, so a payload whose account address was FRESH took the `create` branch, was allowed,
// and still named an existing person primary. The fix is not another check here: it is that
// `Submissions.submitter` is now resolved from the proven address alone, in
// `submitterSpeaker` (@/features/submissions/submit-cast). Who PRESENTS is the payload's to
// say and stays open; who a submission is FILED under is this file's, and it is one address.
//
// THE RULE. An address nobody has used yet is not an identity, so a stranger submitting
// under a fresh address stays exactly as open as it is today: that is the whole point of a
// call for papers and it must not need an account. An address that ALREADY names a record is
// an identity, and attaching to it needs proof that the person submitting controls it. The
// only proof this app has is the magic link, and holding a speaker session for that record is
// what having followed one looks like.
//
// THE TRADEOFF, stated rather than hidden. Refusing costs a returning speaker one round trip
// through /login before they can submit again, and it tells someone who fills in a whole form
// under another person's address that the address is known here. That is a real enumeration
// oracle and it is the price. The alternative weighed against it was binding an unproven
// submission to a fresh PENDING Speakers row and merging once the address is proven: it leaks
// nothing and never refuses, but it needs a merge mechanism that does not exist, it puts
// duplicate people into the CRM, the speaker roster and the agenda in the meantime, and the
// organizer still ends up reading a submission that appears to be from a person who did not
// send it. A refusal writes nothing at all and needs no new machinery, so it wins.
//
// THE TRAP THIS USED TO SET, which is the reason the third input below exists. The rule
// above is right about an address that already names a record, and wrong about how one comes
// to name a record. A first-time anonymous submitter who pressed "Save & finish later" took
// the `create` branch, and `upsertCast` in draft-write.ts wrote the Speakers row. Every later
// action in that same browser (a second save, and the SUBMIT itself) then found that row
// through `findSpeakerByEmail`, held no session, and was refused: the first save created the
// identity the next action was asked to prove. Sign-in here is magic-link only, so the person
// could not finish the submission they had just drafted from the only browser that had it.
//
// The fix is a bearer credential issued at the moment the public path CREATES the row, and it
// grants nothing that was not already granted one request earlier: nobody else could have
// proved that address, because until that request no record was there to prove. It is minted
// only on `create`, so it can never be a way into a record that existed first.
//
// It is NOT the draft's `SESS-<n>` code, which was the obvious candidate and is unusable:
// `code` is an Airtable AUTONUMBER (`mapSubmission` in reads.ts formats the integer), so
// SESS-42 is guessed by counting, and the same string is printed in confirmation email,
// the organizer's Abstracts table, the bundle folder names and the upload API. A guessable,
// widely-printed identifier cannot be proof of anything. This is a signed, short-lived,
// httpOnly-cookie-carried JWT with its own audience instead.
//
// It is NOT a session, either, and the difference is the whole safety argument. A session
// would let the bearer read that speaker's portal, and the address behind a first-time draft
// is unverified: the person who later signs in to it with a magic link may not be the person
// who typed it. This claim is accepted by exactly one check, `submitterBinding`, so all it
// can ever do is let the browser that started a draft finish the same draft.
//
// Nothing here reads a cookie or Airtable, so every argument is supplied by the caller and
// every case is a unit test. The cookie itself is read and written in
// `@/features/submissions/submitter-context`.

import { jwtVerify, SignJWT } from 'jose'

import type { SessionSubject } from '@/features/auth/tokens'
import type { RecordId } from '@/types/domain'

export type SubmitterBinding =
  /** No record under this address. Create one, which is what a first-time submitter does. */
  | { kind: 'create' }
  /** A record exists and this request proved control of it. Attach to it. */
  | { kind: 'bind'; speakerId: RecordId }
  /** A record exists and nothing proved control of it. Write nothing. */
  | { kind: 'unproven'; speakerId: RecordId }

/**
 * `existingSpeakerId` is the row `findSpeakerByEmail` returned for the submitter's address,
 * or `undefined` when there is none. `subject` is the session on the request, if any.
 *
 * An impersonated speaker session counts as proof, deliberately: it is an organizer who
 * already holds `admin` on the event acting as that speaker through View Portal, and they can
 * write the same record directly from the admin app. An ADMIN session does not count, because
 * it proves control of an AdminUsers address and says nothing about this one.
 */
export function submitterBinding(input: {
  existingSpeakerId?: RecordId
  subject?: SessionSubject
  /**
   * The record this browser was handed a draft claim for, from `verifyDraftClaim` below.
   * Proof that this browser is the one that CREATED that record through the public form,
   * which is the only thing it is ever accepted as. See the header.
   */
  claimedSpeakerId?: RecordId
}): SubmitterBinding {
  const { existingSpeakerId, subject, claimedSpeakerId } = input
  if (existingSpeakerId === undefined) return { kind: 'create' }
  if (subject?.kind === 'speaker' && subject.speakerId === existingSpeakerId) {
    return { kind: 'bind', speakerId: existingSpeakerId }
  }
  if (claimedSpeakerId !== undefined && claimedSpeakerId === existingSpeakerId) {
    return { kind: 'bind', speakerId: existingSpeakerId }
  }
  return { kind: 'unproven', speakerId: existingSpeakerId }
}

// ── The draft claim ──────────────────────────────────────────────────────────

const ALGORITHM = 'HS256'
const ISSUER = 'bodo'

/**
 * Its own audience, for the reason tokens.ts pins one on both of the JWTs it signs: all
 * three are HMAC'd with the same secret, so without a distinct audience a claim minted here
 * would verify as a session cookie and hand its bearer the portal.
 */
const DRAFT_CLAIM_AUDIENCE = 'bodo:draft-claim'

/**
 * Thirty days, matching the session cookie rather than the form's close date.
 *
 * A draft can outlive it, and that is deliberate: what expires is the shortcut, not the
 * work. Once it lapses the speaker resumes the way anyone on a second device already does,
 * by signing in with the address the draft is bound to.
 */
export const DRAFT_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function mintDraftClaim(options: {
  speakerId: RecordId
  nowMs: number
  secret: Uint8Array
}): Promise<string> {
  return await new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setAudience(DRAFT_CLAIM_AUDIENCE)
    .setSubject(options.speakerId)
    .setIssuedAt(Math.floor(options.nowMs / 1000))
    .setExpirationTime(Math.floor((options.nowMs + DRAFT_CLAIM_TTL_MS) / 1000))
    .sign(options.secret)
}

/**
 * The record id a claim names, or undefined for anything that is not a live one.
 *
 * Never throws, and never distinguishes expired from forged. A public form has to keep
 * rendering for a visitor whose cookie is a month old or was pasted in by hand, and the only
 * consequence of undefined is that the ordinary rule applies: a fresh address still creates,
 * an address that already names a record still needs a session.
 */
export async function verifyDraftClaim(options: {
  token?: string
  nowMs: number
  secret: Uint8Array
}): Promise<RecordId | undefined> {
  const token = options.token
  if (token === undefined || token === '') return undefined
  try {
    const { payload } = await jwtVerify(token, options.secret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: DRAFT_CLAIM_AUDIENCE,
      requiredClaims: ['sub', 'exp'],
      currentDate: new Date(options.nowMs),
    })
    return typeof payload.sub === 'string' && payload.sub !== '' ? payload.sub : undefined
  } catch {
    return undefined
  }
}

/**
 * What the submitter is told when their address already names a record they have not proved.
 *
 * Deliberately does not say WHOSE record it is, and does not name the address back at them:
 * the refusal already discloses that the address is known here, and repeating it into a page
 * an attacker is looking at adds nothing the visitor does not have in front of them.
 */
export const UNPROVEN_SUBMITTER_MESSAGE =
  'That email address already has a speaker profile here, so we need to know it is yours before filing a submission under it. Go back to the Account step, use the Sign in link there to have a sign-in link emailed to that address, follow it, and you will come back to this form. Then submit again. Your answers stay saved in this browser while you do it.'
