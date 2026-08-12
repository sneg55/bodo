// Whether an anonymous public submission may attach itself to an existing Speakers row.
//
// The case that matters is the third one: an address that already names a record, on a
// request that proved nothing. That is the CFP-02 impersonation finding, and it is the only
// combination that must not resolve to a write.

import { describe, expect, it } from 'vitest'

import {
  DRAFT_CLAIM_TTL_MS,
  mintDraftClaim,
  submitterBinding,
  verifyDraftClaim,
} from '@/features/auth/submitter-identity'
import { mintSessionToken, type SessionSubject, verifySessionToken } from '@/features/auth/tokens'

const SPEAKER_A = 'recSpeakerA'
const SPEAKER_B = 'recSpeakerB'

const SECRET = new TextEncoder().encode('a-test-signing-key-that-is-long-enough')
const OTHER_SECRET = new TextEncoder().encode('a-different-signing-key-entirely-ok')
const NOW = Date.UTC(2026, 7, 11, 12, 0, 0)

const speakerSession: SessionSubject = { kind: 'speaker', speakerId: SPEAKER_A }
const adminSession: SessionSubject = { kind: 'user', userId: 'recAdmin1' }

describe('submitterBinding', () => {
  it('creates a record for an address nobody has used', () => {
    // The whole point of a call for papers: a stranger with a fresh address is not
    // impersonating anyone, so nothing here may ask them to sign in first.
    expect(submitterBinding({ subject: undefined })).toEqual({ kind: 'create' })
  })

  it('still creates for a fresh address when somebody else is signed in', () => {
    expect(submitterBinding({ subject: speakerSession })).toEqual({ kind: 'create' })
  })

  it('refuses to attach an anonymous submission to a record that already exists', () => {
    expect(submitterBinding({ existingSpeakerId: SPEAKER_A, subject: undefined })).toEqual({
      kind: 'unproven',
      speakerId: SPEAKER_A,
    })
  })

  it('attaches when the session is that same speaker', () => {
    expect(submitterBinding({ existingSpeakerId: SPEAKER_A, subject: speakerSession })).toEqual({
      kind: 'bind',
      speakerId: SPEAKER_A,
    })
  })

  it('refuses when the session is a DIFFERENT speaker', () => {
    // Signing in as yourself must not become a licence to submit as anyone else.
    expect(submitterBinding({ existingSpeakerId: SPEAKER_B, subject: speakerSession })).toEqual({
      kind: 'unproven',
      speakerId: SPEAKER_B,
    })
  })

  it('refuses on an admin session, which proves an AdminUsers address and not this one', () => {
    expect(submitterBinding({ existingSpeakerId: SPEAKER_A, subject: adminSession })).toEqual({
      kind: 'unproven',
      speakerId: SPEAKER_A,
    })
  })

  it('attaches for an impersonating organizer, who can already write that record', () => {
    const impersonating: SessionSubject = {
      kind: 'speaker',
      speakerId: SPEAKER_A,
      impersonatorUserId: 'recAdmin1',
      impersonationGrantId: 'grant-1',
    }
    expect(submitterBinding({ existingSpeakerId: SPEAKER_A, subject: impersonating })).toEqual({
      kind: 'bind',
      speakerId: SPEAKER_A,
    })
  })
})

// The sequence a first-time anonymous submitter actually walks, in order, because the defect
// this closes only appears on the SECOND request. Each step below is the binding decision one
// public request makes, with nothing carried between them except the claim.
describe('submitterBinding, the anonymous draft sequence', () => {
  it('1. the first Save & finish later creates: nobody has used this address', () => {
    expect(submitterBinding({ existingSpeakerId: undefined, subject: undefined })).toEqual({
      kind: 'create',
    })
  })

  it('2. the next action in that browser is allowed, because it holds the claim', () => {
    // The row now exists, and it exists BECAUSE of step 1. Without the claim this was the
    // trap: the save created the identity that the submit was then asked to prove.
    expect(
      submitterBinding({
        existingSpeakerId: SPEAKER_A,
        subject: undefined,
        claimedSpeakerId: SPEAKER_A,
      }),
    ).toEqual({ kind: 'bind', speakerId: SPEAKER_A })
  })

  it('3. the same action from a browser with no claim is still refused', () => {
    expect(
      submitterBinding({
        existingSpeakerId: SPEAKER_A,
        subject: undefined,
        claimedSpeakerId: undefined,
      }),
    ).toEqual({ kind: 'unproven', speakerId: SPEAKER_A })
  })

  it('4. a claim for one record proves nothing about SOMEBODY ELSE address', () => {
    // The impersonation case, now with a claim in hand: holding proof of your own draft must
    // not become a licence to submit under somebody else's address.
    expect(
      submitterBinding({
        existingSpeakerId: SPEAKER_B,
        subject: undefined,
        claimedSpeakerId: SPEAKER_A,
      }),
    ).toEqual({ kind: 'unproven', speakerId: SPEAKER_B })
  })
})

describe('the draft claim itself', () => {
  it('round-trips the record it was minted for', async () => {
    const token = await mintDraftClaim({ speakerId: SPEAKER_A, nowMs: NOW, secret: SECRET })
    await expect(verifyDraftClaim({ token, nowMs: NOW + 1000, secret: SECRET })).resolves.toBe(
      SPEAKER_A,
    )
  })

  it('is undefined once it has expired', async () => {
    const token = await mintDraftClaim({ speakerId: SPEAKER_A, nowMs: NOW, secret: SECRET })
    await expect(
      verifyDraftClaim({ token, nowMs: NOW + DRAFT_CLAIM_TTL_MS + 60_000, secret: SECRET }),
    ).resolves.toBeUndefined()
  })

  it('is undefined under a different key, so it cannot be forged without the secret', async () => {
    // The reason this is a signed token and not the draft's `SESS-<n>` code. That code is an
    // Airtable autonumber printed in email, in the organizer's table and in folder names, so
    // possessing one proves nothing; possessing this requires the signing key.
    const token = await mintDraftClaim({ speakerId: SPEAKER_A, nowMs: NOW, secret: SECRET })
    await expect(
      verifyDraftClaim({ token, nowMs: NOW, secret: OTHER_SECRET }),
    ).resolves.toBeUndefined()
  })

  it('is undefined for a missing, empty or mangled cookie rather than throwing', async () => {
    // A public form has to render for a visitor whose cookie is a month old or was pasted in
    // by hand. The only cost of undefined is the shortcut.
    await expect(verifyDraftClaim({ nowMs: NOW, secret: SECRET })).resolves.toBeUndefined()
    await expect(
      verifyDraftClaim({ token: '', nowMs: NOW, secret: SECRET }),
    ).resolves.toBeUndefined()
    await expect(
      verifyDraftClaim({ token: 'not.a.token', nowMs: NOW, secret: SECRET }),
    ).resolves.toBeUndefined()
  })

  it('is not a session, and a session is not one of these', async () => {
    // All three of bodo's tokens are HMAC'd with the same secret, so the audience is the only
    // thing keeping them apart. Without this, a claim minted by a PUBLIC endpoint would be
    // accepted as a 30 day speaker session and hand its bearer that speaker's portal.
    const claim = await mintDraftClaim({ speakerId: SPEAKER_A, nowMs: NOW, secret: SECRET })
    await expect(verifySessionToken({ token: claim, nowMs: NOW, secret: SECRET })).rejects.toThrow()

    const session = await mintSessionToken({
      subject: { kind: 'speaker', speakerId: SPEAKER_A },
      nowMs: NOW,
      secret: SECRET,
    })
    await expect(
      verifyDraftClaim({ token: session, nowMs: NOW, secret: SECRET }),
    ).resolves.toBeUndefined()
  })
})
