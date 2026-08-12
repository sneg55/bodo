// What every bulk-composer action needs before it can do anything: the event, and who the
// selection actually resolves to.
//
// Its own module rather than a helper inside the actions file for one reason that is not
// tidiness: a `'use server'` file may only export async functions, so a shared TYPE has to
// live outside it, and the three actions all hand the same shape back to the composer.
//
// Deliberately does NOT authorize. `requireEventRole` is called at the top of each action,
// where a reviewer can see it, because a guard buried in a loader is a guard the next action
// added to that file will forget to inherit. This module is data only.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { BulkEventContext } from '@/features/comms/bulk-compose'
import {
  type BulkRecipientResolution,
  resolveBulkRecipients,
} from '@/features/comms/bulk-recipients'
import { isBlankRichText } from '@/features/forms/builder/emptiness'
import { getEvent, listSpeakers } from '@/services/airtable/queries'
import type { Event, RecordId } from '@/types/domain'

export type BulkComposeContext = {
  readonly event: Event
  readonly resolution: BulkRecipientResolution
}

/**
 * The event and the resolved recipients, in one pass.
 *
 * Both reads are the CACHED ones, which is the same considered choice `inviteSpeakersAction`
 * documents: what is being taken from the roster is which ids belong to this event and what
 * their addresses are, and neither changes between a preview and the send a few seconds
 * later. A stale row here costs a message addressed to a name that was edited moments ago,
 * not a message to the wrong person.
 */
export async function loadBulkComposeContext(
  eventId: RecordId,
  speakerIds: readonly RecordId[],
): Promise<BulkComposeContext> {
  const [event, roster] = await Promise.all([getEvent(eventId), listSpeakers(eventId)])
  return { event, resolution: resolveBulkRecipients(roster, speakerIds) }
}

/** The event's merge-visible half, so the composer and the sender read the same fields. */
export function eventContext(event: Event): BulkEventContext {
  return {
    name: event.name,
    slug: event.slug,
    ...(event.startsAt === undefined ? {} : { startsAt: event.startsAt }),
    ...(event.location === undefined ? {} : { location: event.location }),
  }
}

/**
 * Refuse a draft that cannot be sent, before anything is rendered.
 *
 * A blank subject is the one that matters. `resolveTemplate` falls back to a built-in subject
 * when a STORED template leaves it empty, because there is a template behind it to fall back
 * to; a composed message has none, so an empty subject here would queue mail with no subject
 * line rather than degrade to something sensible.
 *
 * The body goes through `isBlankRichText`, the SHARED emptiness rule, rather than a local tag
 * strip. TipTap serialises a cleared document to an empty paragraph, so a length check on the
 * raw HTML would call that a body, and a hand-written strip would call a body of exactly one
 * `<img>` empty, which is the exact drift that predicate was split out to end.
 *
 * The empty-recipient refusal names WHICH emptiness it is, and that is not politeness. From
 * the cross-event CRM the ordinary cause is a selection that belongs to other conferences,
 * and telling that organizer "nobody has an email address" would send them to check fifteen
 * records for a problem none of them has.
 */
export function assertSendable(input: {
  subject: string
  bodyHtml: string
  resolution: Pick<BulkRecipientResolution, 'recipients' | 'unknownIds'>
}): void {
  if (input.subject.trim() === '') {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Give the email a subject before sending it.', {})
  }
  if (isBlankRichText(input.bodyHtml)) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Write a message body before sending it.', {})
  }
  if (input.resolution.recipients.length === 0) {
    throw new AppError(
      ErrorIds.DATA_RECORD_NOT_FOUND,
      input.resolution.unknownIds > 0
        ? 'Nobody in that selection is on this event. Pick the event they belong to.'
        : 'Nobody in that selection has an email address on this event.',
      {},
    )
  }
}
