// Speaker writes that are not owned by another module: the CFP upsert, the portal profile
// edit, and the portal invitation stamp. Split from mutations.ts for the line limit, same
// rule as every other split in this directory: every write ends by invalidating the tags it
// affected, through invalidate.ts.
//
// Two branches created a file at this path independently and it was merged by hand. One
// brought the upsert and the profile edit, the other brought `markSpeakersInvited`; the
// note on that function about `saveSpeakerProfile` living in mutations.ts was written
// before the split and now points here, two functions up.

import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapSpeaker } from '@/services/airtable/mapping'
import { findByText } from '@/services/airtable/reads'
import { linkIds, onlyRecord, view } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventSpeakersTag, eventSubmissionsTag, speakerTag } from '@/services/airtable/tags'
import { type SpeakerDraft, speakerFields } from '@/services/airtable/to-fields'
import type { RecordId, Speaker } from '@/types/domain'

export type UpsertSpeakerOptions = {
  /**
   * Whether an EXISTING row's profile fields may be overwritten. Default true.
   *
   * Pass `false` for anybody the writer has not proved they are, which on a public CFP is
   * every co-participant: the submitter types a co-presenter's name and email, and before
   * this flag existed that wrote the typed `firstName`, `lastName`, `bio`, `company` and
   * `tagline` straight over the co-presenter's own record. A conference roster is a set of
   * real people's profiles, and one speaker naming another is not a reason to let them
   * rewrite it.
   *
   * It affects the UPDATE branch only. Creating a row from what the submitter typed is the
   * whole point when nobody with that address exists yet, and the event link is merged
   * either way, because being named on a submission genuinely does put somebody on the
   * event.
   */
  profileWrites?: boolean
}

/**
 * Find a speaker by email, or create one, and return the row.
 *
 * Email is the identity a magic link and the portal both key on, so this is the
 * first thing a CFP submit does. The lookup is deliberately uncached: choosing
 * between create and update from a cached answer is how one speaker ends up with
 * two records a few hundred milliseconds apart.
 */
export async function upsertSpeakerByEmail(
  draft: SpeakerDraft,
  origin: WriteOrigin = 'action',
  options: UpsertSpeakerOptions = {},
): Promise<Speaker> {
  const client = getClient()
  const existing = await findByText(TABLES.speakers, COL.email, draft.email)

  if (existing === undefined) {
    const created = await client.createRecords(TABLES.speakers, [speakerFields(draft)])
    // `try`/`finally` for the reason `saveSpeakerProfile` documents at length below, and it
    // is the same defect: `onlyRecord` throws on a 200 with an empty `records` array, and
    // the speaker that response cannot name has still been created. Letting that throw sit
    // between the write and `invalidate` left `event:{id}:speakers` unexpired, so a
    // co-presenter created by a CFP submit was missing from the admin speaker list and the
    // CRM directory for the whole `REVALIDATE.edited` window. `finally` does not catch, so
    // the throw still reaches the caller. `createRecords` stays outside it: a REJECTED
    // request wrote nothing and has nothing to expire.
    let speakerId: RecordId | undefined
    try {
      const speaker = mapSpeaker(onlyRecord(created, TABLES.speakers))
      speakerId = speaker.id
      return speaker
    } finally {
      afterSpeakerWrite(origin, speakerId, draft.eventIds)
    }
  }

  // The event link is merged, not replaced: a returning speaker is on more than one
  // event, and writing only the current event id would drop them from the others.
  const eventIds = new Set([
    ...linkIds(view(TABLES.speakers, existing), COL.events),
    ...(draft.eventIds ?? []),
  ])
  // With `profileWrites: false` the ONLY field written is the merged event link. Not a
  // narrowed `speakerFields` call: that helper decides which columns a draft maps to, and
  // reusing it here would silently start writing any column added to it later.
  const fields =
    options.profileWrites === false
      ? { [COL.events]: [...eventIds] }
      : speakerFields({ ...draft, eventIds: [...eventIds] })

  const updated = await client.updateRecords(TABLES.speakers, [{ id: existing.id, fields }])
  // Nothing here needs the response to name its tags: the row's id is `existing.id` and the
  // event ids were computed above, so this `finally` expires the full set either way.
  try {
    return mapSpeaker(onlyRecord(updated, TABLES.speakers))
  } finally {
    afterSpeakerWrite(origin, existing.id, [...eventIds])
  }
}

/**
 * Invalidation for a speaker upsert, inside the mutation rather than at the call site.
 *
 * It used to be nowhere, which meant a co-presenter created by a CFP submit did not
 * appear in the admin's speaker list until the cache lifetime ran out, and the one
 * caller that remembered had to know which tags a write it does not own affects. A
 * caller can forget; a mutation cannot.
 *
 * The speaker list is scoped by the `events` link, so every event the row now belongs to
 * has a list that just changed, not only the one this write came through.
 *
 * `speakerId` is optional because the create path calls this from a `finally` that may be
 * running because the response could not be read: the event tags are still known from the
 * draft and are expired regardless, and only `speaker:{id}` drops out, which is the floor
 * the same way `saveSpeakerProfile`'s `eventIds` is.
 */
function afterSpeakerWrite(
  origin: WriteOrigin,
  speakerId: RecordId | undefined,
  eventIds: readonly RecordId[] | undefined,
): void {
  invalidate(origin, {
    own: [
      ...(speakerId === undefined ? [] : [speakerTag(speakerId)]),
      ...(eventIds ?? []).map(eventSpeakersTag),
    ],
  })
}

export type ProfileUpdate = {
  speakerId: RecordId
  eventId: RecordId
  draft: SpeakerDraft
}

/**
 * Section 5.2: a portal profile edit is visible admin-side straight away.
 *
 * Same defect this file already fixed on `upsertSpeakerByEmail`'s update path, applied
 * here: a speaker's `events` link can hold more than one event, and this write only ever
 * named `update.eventId`'s tags. A speaker presenting at events A and B, editing their
 * profile through A, left B's CRM directory and B's submissions (which carry the resolved
 * cast) serving the old name, company and biography.
 *
 * `updateRecords` returns the row's full current field values, not only the ones this
 * write touched, so reading `events` off that response costs no extra request. But the
 * first version of this fix, and then the one after it, each got one half of what a
 * response `onlyRecord` cannot read (a 200 with an empty records array) requires:
 *
 *   - Version one let `onlyRecord`'s throw sit between the write and `invalidate`, so a
 *     successful-but-empty response expired NOTHING - "successful response, wrong record
 *     count, so treat it as nothing written," the exact false claim
 *     `mutations-crm-import-write.ts`'s `onUncertainWrite` exists to reject.
 *   - Version two caught that throw and fell back to just `update.eventId`, fixing the
 *     invalidation - but swallowed the error entirely, so `saveProfileAction`
 *     (features/portal/actions.ts) went on to tell the speaker "Your changes have been
 *     saved" for a write this function could not actually confirm landed. A stale cache
 *     self-corrects in 60 seconds; a false confirmation does not, which makes that worse
 *     than the bug this whole file exists to fix.
 *
 * `try`/`finally` is what keeps both properties at once: `eventIds` starts at the floor
 * (`update.eventId` alone) and is only widened inside the `try`, so if `onlyRecord` throws,
 * `eventIds` is still whatever it was initialized to when `finally` runs `invalidate` - and
 * then, because `finally` does not catch, the throw continues past it to the caller.
 * `getClient().updateRecords` itself stays OUTSIDE the try/finally: a request that is
 * actually REJECTED (a thrown 4xx/5xx, not a 200 with nothing in it) really did write
 * nothing, and invalidating for a no-op write would be manufacturing staleness risk with
 * no write behind it - every other write in this file already leaves invalidation unreached
 * in that case, and this one still does too.
 */
export async function saveSpeakerProfile(
  update: ProfileUpdate,
  origin: WriteOrigin = 'action',
): Promise<void> {
  const updated = await getClient().updateRecords(TABLES.speakers, [
    { id: update.speakerId, fields: speakerFields(update.draft) },
  ])

  let eventIds: ReadonlySet<RecordId> = new Set([update.eventId])
  try {
    eventIds = new Set([
      ...linkIds(view(TABLES.speakers, onlyRecord(updated, TABLES.speakers)), COL.events),
      update.eventId,
    ])
  } finally {
    invalidate(origin, {
      own: [
        speakerTag(update.speakerId),
        ...[...eventIds].map(eventSpeakersTag),
        // Submission rows carry the resolved cast, so a renamed speaker changes them, on
        // every event they present at, not only the one this edit came through.
        ...[...eventIds].map(eventSubmissionsTag),
      ],
    })
  }
}

/**
 * Record that a portal invitation went out, for one speaker or forty.
 *
 * Written AFTER the outbox rows, and the order is deliberate. The stamp is what the next
 * invite's idempotency key is built from, so writing it first and then failing to enqueue
 * would leave a speaker marked as invited who was never written to, and the retry would
 * compute a different key and be indistinguishable from a genuine re-invite. Enqueueing
 * first fails the other way: the mail is queued and the stamp is missing, so the roster
 * still reads "Not invited" and pressing again is a no-op the enqueue collapses. A visible
 * disagreement that sends nothing twice beats a silent one that sends nothing at all.
 *
 * The event's speaker list is expired as well as each speaker, because the roster reads the
 * list and it is the roster that renders the stamp.
 */
export async function markSpeakersInvited(
  input: {
    eventId: RecordId
    speakerIds: readonly RecordId[]
    invitedAt: string
  },
  origin: WriteOrigin = 'action',
): Promise<void> {
  if (input.speakerIds.length === 0) return

  // `try`/`finally`, because "forty speakers" is more than one HTTP request: `updateRecords`
  // chunks at ten internally, so a rejection on the fourth chunk leaves the first thirty
  // stamped in Airtable and, without this, expires nothing. The roster would then keep
  // reading "Not invited" for people who were just invited. Same shape, and the same fix, as
  // `setSpeakerTags` and `enqueueEmails`.
  //
  // The write sits INSIDE the `try` here, unlike `saveSpeakerProfile` two functions up, and
  // the difference is not a style choice: that one always writes exactly one record, so a
  // rejection means nothing landed and invalidating would manufacture staleness with no write
  // behind it. This one is many records over many requests, so a rejection means some of them
  // probably DID land. `finally` does not catch, so the error still propagates either way.
  try {
    await getClient().updateRecords(
      TABLES.speakers,
      input.speakerIds.map((speakerId) => ({
        id: speakerId,
        fields: { [COL.invitedAt]: input.invitedAt },
      })),
    )
  } finally {
    invalidate(origin, {
      own: [eventSpeakersTag(input.eventId), ...input.speakerIds.map((id) => speakerTag(id))],
    })
  }
}
