// Turning a prepared submission's participants into real Speakers rows and link records.
//
// Split out of actions.ts when the impersonation guard landed and that file passed the 300
// line budget. The seam is a real one: actions.ts decides whether a submit is ALLOWED and
// what it says back to the browser, and this file is the one place that writes people.
//
// It carries the rule that a public submit may not rewrite somebody else's profile, which is
// the second half of the hole `@/features/auth/submitter-identity` describes. The first half
// (an anonymous POST attaching itself to an existing record) is refused before anything here
// runs; this half is about the co-presenters that same POST names, who never proved anything
// and whose records still have to be linked to the event.
//
// It also decides WHO A SUBMISSION IS FILED UNDER, which is a different question from who is
// presenting it, and answering the first with the second was the way round that guard. See
// `submitterSpeaker` below.

import type { PreparedParticipant } from '@/features/submissions/prepare'
import { upsertSpeakerByEmail } from '@/services/airtable/mutations-speakers'
import type { ParticipantDraft } from '@/services/airtable/to-fields'
import type { RecordId, Speaker } from '@/types/domain'

/** The three values the Account step collects. `email` is the address a request PROVES. */
export type SubmitterIdentity = { email: string; firstName: string; lastName: string }

/**
 * Speakers keyed by the email they were upserted under, so a form that lists the same
 * person twice gets one row rather than two. Sequential because the DAL's per-base
 * scheduler rate-limits anyway, and a find-or-create racing itself is exactly how one
 * speaker ends up with two records a few hundred milliseconds apart.
 *
 * `submitterEmail` is the one address this request PROVED, and it is the only one whose
 * existing profile may be overwritten. A co-presenter is named by somebody else: the
 * submitter types their name and email into the wizard, and before this the update branch of
 * `upsertSpeakerByEmail` wrote that typed `firstName`, `lastName` and any bio, company or
 * tagline answer straight over the co-presenter's own record. Being named on a submission is
 * a reason to link that person to the event, which still happens through the merged event
 * link, and not a reason to let a stranger rewrite their profile.
 *
 * A co-presenter with NO record yet is still created from what was typed, because there is
 * no profile to protect and the alternative is a submission whose participant does not exist.
 */
export async function upsertSpeakers(
  participants: readonly PreparedParticipant[],
  submitterEmail: string,
): Promise<ReadonlyMap<string, Speaker>> {
  const speakers = new Map<string, Speaker>()
  const proven = submitterEmail.trim().toLowerCase()

  for (const participant of participants) {
    const email = participant.draft.email
    if (speakers.has(email)) continue
    speakers.set(
      email,
      await upsertSpeakerByEmail(participant.draft, 'action', {
        profileWrites: email.trim().toLowerCase() === proven,
      }),
    )
  }
  return speakers
}

/**
 * The Speakers row a submission is FILED UNDER, which is `Submissions.submitter`.
 *
 * It is the address the Account step PROVED, and never whichever participant the payload
 * flagged `isPrimary`. Reading one off the other was an impersonation hole, and it survived
 * the guard in `@/features/auth/submitter-identity` because that guard is checked against
 * the account address alone: a payload naming a FRESH address takes the `create` branch and
 * is allowed, while its participant list flags an existing person primary. `submitterId`
 * then pointed at THAT person's record, so the submission counted against their per-form
 * cap, addressed its confirmation email to them, and read as filed by them in the
 * organizer's Abstracts table. Nothing proved anything about that address. Worse on the
 * draft path: `saveCfpDraft` hands out a draft claim for the row it just filed under, so the
 * same payload minted a claim for somebody else's record, and a second request presenting it
 * bound to that record with `profileWrites` on.
 *
 * Being NAMED on somebody else's submission stays open, because that is what a co-presenter
 * is, and `upsertSpeakers` above already keeps their profile from being rewritten. What is
 * closed is the submission being ATTRIBUTED to them. Who PRESENTS is still the payload's to
 * say: `isPrimary` is written to the participant row untouched.
 *
 * The submitter is normally on the cast, because the wizard seeds the primary participant
 * from the Account step, and then this is a map lookup and no extra write. When they are not
 * (every participant row was retyped to somebody else) their row is upserted here, because
 * `Submissions.submitter` is a link that has to point somewhere and the only alternative is
 * pointing it at a person who did not submit.
 */
export async function submitterSpeaker(input: {
  /** Already upserted by `upsertSpeakers`, keyed by the same normalized address. */
  speakers: ReadonlyMap<string, Speaker>
  submitter: SubmitterIdentity
  eventId: RecordId
}): Promise<Speaker> {
  const email = input.submitter.email.trim().toLowerCase()
  const onCast = input.speakers.get(email)
  if (onCast !== undefined) return onCast

  // `profileWrites` on, and it is the same rule `upsertSpeakers` states: this is the one
  // address the request proved, so it is the one profile a public submit may write.
  return await upsertSpeakerByEmail(
    {
      email,
      firstName: blankToUndefined(input.submitter.firstName),
      lastName: blankToUndefined(input.submitter.lastName),
      eventIds: [input.eventId],
    },
    'action',
    { profileWrites: true },
  )
}

/** `speakerFields` drops `undefined` and clears an empty string, and blank means neither. */
function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

export function participantDrafts(
  participants: readonly PreparedParticipant[],
  speakers: ReadonlyMap<string, Speaker>,
): readonly ParticipantDraft[] {
  const drafts: ParticipantDraft[] = []
  for (const participant of participants) {
    const speaker = speakers.get(participant.draft.email)
    if (speaker === undefined) continue
    drafts.push({
      speakerId: speaker.id,
      role: participant.role,
      isPrimary: participant.isPrimary,
      sortOrder: participant.sortOrder,
    })
  }
  return drafts
}
