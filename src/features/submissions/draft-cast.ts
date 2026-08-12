// Who is on a draft.
//
// This existed as "the submitter, and nobody else", and the reason was honest at the time:
// the portal's roster was READ-ONLY, so a co-speaker written into a draft could never be
// corrected there, and a cast that silently stops updating is worse than one that was never
// claimed. ABS-11 removed that wall (`roster-rules.ts`, `RosterControls.tsx`), so the
// reason is gone and the cast is carried.
//
// THE CAST IS WRITTEN ONCE, AT CREATION, and a later draft save updates the body only.
// That is now a boundary rather than a limitation: after creation the roster belongs to the
// authenticated portal editor, and a public endpoint that reconciled the cast on every save
// would let a stale wizard tab DELETE co-speakers somebody curated while signed in. The
// wizard decides the initial cast; the portal owns it from then on.
//
// The bound on what this can create is the form's own: a co-speaker with an unusable email
// is dropped rather than turned into a junk Speakers row from a public endpoint, and the
// role maxima are the ones `validateParticipants` enforces for a real submit. Only
// `ROLE_MIN` is forgiven, which is the participant-side twin of forgiving `REQUIRED`: not
// having added the second speaker yet is what a draft IS.

import type { Problem } from '@/features/forms/validate'
import { ProblemCodes, validateParticipants } from '@/features/forms/validate'
import type { ParticipantRow } from '@/features/submissions/participants'
import { speakerDraftFor } from '@/features/submissions/participants'
import type { SubmitPayload } from '@/features/submissions/payload'
import {
  type PreparedParticipant,
  participantRows,
  primaryRole,
} from '@/features/submissions/prepare'
import type { RecordId } from '@/types/domain'
import type { Form } from '@/types/forms'

/** Loose, and the same shape `identityProblems` binds the draft's own address with. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export type DraftCastResult =
  | { ok: true; participants: readonly PreparedParticipant[] }
  | { ok: false; problems: readonly Problem[] }

export function draftCast(input: {
  form: Form
  payload: SubmitPayload
  eventId: RecordId
}): DraftCastResult {
  const { form, payload, eventId } = input
  const rows = writableRows(form, payload)

  // Role limits are the form's, checked by the same function the wizard and
  // `prepareSubmission` use, so the draft cannot hold a cast the submit would refuse. A
  // shortfall is not a refusal: see the header.
  const problems = validateParticipants(form.roles, rows).filter(
    (problem) => problem.code !== ProblemCodes.ROLE_MIN,
  )
  if (problems.length > 0) return { ok: false, problems }

  return {
    ok: true,
    participants: rows.map((row, index) => ({
      draft: speakerDraftFor({ participant: row, fields: form.participantFields, eventId }),
      role: row.role,
      isPrimary: row.isPrimary,
      sortOrder: index + 1,
    })),
  }
}

/**
 * The rows that can actually become records.
 *
 * Three filters, in order, and each one has a record behind it:
 *
 *   - an empty cast falls back to the submitter alone. The wizard only seeds the primary
 *     participant on the way INTO the Participant step, so a draft saved from the
 *     Submission step posts no participants at all, and `checkPrimary` would refuse it for
 *     having no primary. Saving early is the main thing the button is for.
 *   - a row with no usable email is dropped. `upsertSpeakerByEmail` keys on the address, so
 *     a half-typed one either creates a junk Speakers row or collides with somebody.
 *   - duplicates by address collapse, matching `upsertSpeakers` on the submit path, so one
 *     person listed twice is one Speakers row and one participant row rather than two.
 */
function writableRows(form: Form, payload: SubmitPayload): readonly ParticipantRow[] {
  const rows = participantRows({ form, payload })
  const usable = rows.filter((row) => EMAIL_SHAPE.test(row.identity.email.trim().toLowerCase()))
  const deduped = dedupeByEmail(usable)
  if (deduped.length > 0) return deduped

  return [
    {
      role: primaryRole(form),
      isPrimary: true,
      identity: {
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
      },
      answers: {},
    },
  ]
}

/** First occurrence wins, and the primary is promoted so the cast keeps exactly one. */
function dedupeByEmail(rows: readonly ParticipantRow[]): readonly ParticipantRow[] {
  const byEmail = new Map<string, ParticipantRow>()
  for (const row of rows) {
    const email = row.identity.email.trim().toLowerCase()
    const seen = byEmail.get(email)
    if (seen === undefined) {
      byEmail.set(email, row)
      continue
    }
    // One person listed as both the submitter and a co-speaker keeps the primary flag,
    // because the submitter is who every "who do we email" read resolves to.
    if (row.isPrimary && !seen.isPrimary) byEmail.set(email, row)
  }
  return [...byEmail.values()]
}
