'use server'

// What the bulk composer needs when it is opened from the CROSS-EVENT directory. CRM-11.
//
// THE PROBLEM THIS FILE SOLVES, stated before the code, because the answer is a product
// decision rather than a detail. The CRM is cross-event by definition, so a selection of
// fifteen people can span three conferences and include somebody who is on none of the
// viewer's events at all. The composer is event-scoped in every part that matters: the merge
// context supplies `{{event.name}}`, the starters are `EmailTemplates` rows belonging to one
// event, the authorization is `requireEventRole(eventId, 'admin')`, and the Email history row
// is written under one event. There is no coherent reading of "send to this selection" that
// leaves all four unanswered.
//
// The decision: A SEND IS SCOPED TO ONE EVENT, CHOSEN IN THE COMPOSER, AND THE UI SAYS WHO
// THAT EXCLUDES BEFORE ANYTHING IS SENT.
//
// The alternatives were considered and rejected for concrete reasons rather than taste:
//
//   - Sending per event under the hood, one batch per conference each recipient belongs to,
//     is the most powerful answer and the least honest one. The organizer writes ONE body,
//     and that body says something like "your session is confirmed for the 14th", which is
//     true of one conference and false of the other. Fanning it out would mail a correct
//     `{{event.name}}` attached to wrong content, which is worse than a send that excluded
//     people, because nothing about it looks wrong to the sender.
//   - Offering only event-neutral merge fields and refusing `{{event.*}}` would make the CRM
//     composer a different, weaker editor than the roster one, and it still has to pick an
//     event to authorize against and to log under. It removes the visible half of the problem
//     and keeps the invisible half.
//
// Scoping to one event is what makes the safety property STRUCTURAL rather than promised:
// `loadBulkComposeContext` resolves the selection against `listSpeakers(eventId)`, so a
// person who is not on the chosen event is not a recipient, and there is no code path that
// could give them an email naming a conference they are not part of. This file's job is to
// make that exclusion VISIBLE, which is the part a resolution alone does not do.

import { requireEventRole } from '@/features/auth/wiring'
import { loadBulkComposeContext } from '@/features/comms/bulk-context'
import { requireCrmScope } from '@/features/crm/scope'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { getEvent } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

export type CrmSendEvent = { readonly id: RecordId; readonly name: string }

/**
 * The events this viewer may send from.
 *
 * `adminEventIds` and NOT `eventIds`, which is the difference between a picker that works
 * and one that offers a choice the send will refuse: every action behind the composer calls
 * `requireEventRole(eventId, 'admin')`, and a reviewer holds `reviewer` on some of their
 * memberships. Listing an event somebody cannot send from is the dead-control shape.
 *
 * Sorted by name because the scope's own order is membership order, which means nothing to
 * an organizer reading a dropdown.
 */
export async function loadCrmSendEventsAction(): Promise<
  ActionResult<{ events: readonly CrmSendEvent[] }>
> {
  try {
    const scope = await requireCrmScope()
    const events = await Promise.all(
      scope.adminEventIds.map(async (eventId) => {
        const event = await getEvent(eventId)
        return { id: event.id, name: event.name }
      }),
    )

    return actionOk({
      events: [...events].sort((left, right) => left.name.localeCompare(right.name)),
    })
  } catch (error) {
    return actionFailure(error)
  }
}

export type CrmRecipientScope = {
  /** How many of the selection would actually be mailed. */
  readonly recipients: number
  /**
   * Selected, and not on the chosen event.
   *
   * The number this whole file exists to surface. It is the honest cost of scoping a
   * cross-event selection to one event, and an organizer has to see it BEFORE they send, not
   * discover it from a count afterwards.
   */
  readonly notOnEvent: number
  readonly skippedNoEmail: number
  readonly skippedDuplicate: number
}

/**
 * Resolve a selection against one event, with no subject and no body.
 *
 * Separate from `previewBulkEmailAction` on purpose: this answers "who would this reach",
 * which the organizer needs the moment they pick an event and long before they have written
 * anything. A preview needs a draft; this needs only the selection, so the scope line under
 * the event picker can be right from the first render.
 *
 * Authorizes for itself. It reports the shape of somebody's roster, which is not a secret an
 * arbitrary caller may probe.
 */
export async function resolveCrmRecipientsAction(input: {
  eventId: RecordId
  speakerIds: readonly RecordId[]
}): Promise<ActionResult<CrmRecipientScope>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const { resolution } = await loadBulkComposeContext(input.eventId, input.speakerIds)

    return actionOk({
      recipients: resolution.recipients.length,
      notOnEvent: resolution.unknownIds,
      skippedNoEmail: resolution.skippedNoEmail,
      skippedDuplicate: resolution.skippedDuplicate,
    })
  } catch (error) {
    return actionFailure(error)
  }
}
