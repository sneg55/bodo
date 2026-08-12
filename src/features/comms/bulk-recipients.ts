// Who a bulk send actually goes to, resolved from the event's own roster. SPK-13.
//
// The composer and the task reminder both take a list of speaker ids from a browser, and a
// Server Action is reachable by POST with no page ever rendering. So the ids are a FILTER
// over the authorized event's roster and never a recipient list: the worst a forged call can
// do is mail people the organizer could have mailed anyway. That is the same rule
// `inviteSpeakersAction` and `remindReviewersAction` already follow, lifted here so the two
// new senders cannot each half-implement it.
//
// Three ways a selected person does not receive the message, and all three are COUNTED
// rather than swallowed, because a bulk control that reports "12 queued" over a selection of
// fifteen has to be able to say what happened to the other three:
//
//   1. No address on file. A roster carries people an organizer added by name alone, and
//      refusing to mail the other thirty-nine because of one of them is not what a bulk
//      control is for.
//   2. A duplicate address. Two roster rows can carry one mailbox (the same person imported
//      twice, or a shared team address), and one message per row means that mailbox gets two.
//   3. An id that is not on this roster at all. Ordinarily impossible from the UI, which is
//      exactly why it is worth counting: a non-zero value here means something posted ids
//      this event does not own.
//
// Pure, and tested in tests/comms-bulk-recipients.test.ts.

import type { RecordId, Speaker } from '@/types/domain'

export type BulkRecipient = {
  readonly speakerId: RecordId
  readonly email: string
  readonly firstName: string
  readonly lastName: string
  readonly company?: string
}

export type BulkRecipientResolution = {
  readonly recipients: readonly BulkRecipient[]
  /** Selected, on the roster, and with no address on file. */
  readonly skippedNoEmail: number
  /** Selected and collapsed away, because an earlier row carried the same mailbox. */
  readonly skippedDuplicate: number
  /** Asked for and not on this event's roster. Non-zero means ids were posted, not picked. */
  readonly unknownIds: number
}

/**
 * The selected people, in ROSTER order, one per mailbox.
 *
 * Roster order rather than selection order so the preview shows the same first recipient on
 * every press: a preview whose subject changes because the organizer ticked the boxes in a
 * different sequence reads as a bug in the merge fields.
 *
 * An empty `selectedIds` resolves to nobody rather than to everybody. "Send to all" is a
 * thing an organizer does by selecting all, which the roster's header checkbox already does
 * over what is VISIBLE, and an empty selection quietly meaning the whole roster is how eighty
 * people get an email nobody chose.
 */
export function resolveBulkRecipients(
  roster: readonly Speaker[],
  selectedIds: readonly RecordId[],
): BulkRecipientResolution {
  const wanted = new Set(selectedIds)
  const onRoster = roster.filter((speaker) => wanted.has(speaker.id))

  const seen = new Set<string>()
  const recipients: BulkRecipient[] = []
  let skippedNoEmail = 0
  let skippedDuplicate = 0

  for (const speaker of onRoster) {
    const mailbox = speaker.email.trim().toLowerCase()
    if (mailbox === '') {
      skippedNoEmail += 1
      continue
    }
    if (seen.has(mailbox)) {
      skippedDuplicate += 1
      continue
    }
    seen.add(mailbox)
    recipients.push({
      speakerId: speaker.id,
      // The address as STORED, not the lowercased key. The key exists to compare mailboxes;
      // the mail goes to what the organizer typed, because some providers are case sensitive
      // in the local part and rewriting it is not this function's business.
      email: speaker.email.trim(),
      firstName: speaker.firstName,
      lastName: speaker.lastName,
      ...(speaker.company === undefined ? {} : { company: speaker.company }),
    })
  }

  // Counted against DISTINCT ids, so a client sending the same id twice does not report a
  // phantom stranger on the roster.
  const distinct = new Set(selectedIds).size

  return {
    recipients,
    skippedNoEmail,
    skippedDuplicate,
    unknownIds: distinct - onRoster.length,
  }
}

/**
 * What to call the recipient, never an empty string.
 *
 * The same degradation `invite-outbox.ts` and `reminders.ts` both apply, and for the same
 * defect: `renderTemplate` treats an empty merge value as one the context cannot supply and
 * throws, so a Speakers row with a blank first name would take the whole batch down rather
 * than its own message. A roster imported from a spreadsheet of addresses is the ordinary
 * case for a bulk send and half of it may have no name at all.
 */
export function greetingName(recipient: BulkRecipient): string {
  const first = recipient.firstName.trim()
  if (first !== '') return first
  const last = recipient.lastName.trim()
  if (last !== '') return last
  return 'there'
}
