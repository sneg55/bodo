// The composed reads behind the two portal admin surfaces. BUILD_SPEC 5.0c.
//
// Everything here reads cached, tagged lists through `@/services/airtable/queries` and then
// applies the pure modules beside this file (./contacts, ./match, ./content). Nothing here
// caches and nothing here filters in a formula: the cache is on the request, in
// reads-portals.ts and reads-resources.ts, and all three lists share one tag identity
// (`eventPortalsTag` is `eventResourcesTag`, tags.ts says why).
//
// The WRITE path never comes through here. `savePortal` and the reorder read
// `listPortalsUncached` instead, because deciding exactly-one-default or a dense renumber
// from a cached snapshot is how an event ends up with two defaults or a tie.
//
// No authorization in this file, matching `features/resources/reads.ts`: these run inside
// admin pages that the `(admin)/admin/[eventId]` layout has already redirected a stranger
// away from, and ./authorize.ts carries `isEventOrganizer` for a page that wants to render
// nothing rather than throw. The enforcement that matters is in ./actions.ts, on the writes.

import { buildPortalContacts } from '@/features/portal-config/contacts'
import { buildPortalContent, type PortalContent } from '@/features/portal-config/content'
import { assignContacts, matchesFilters } from '@/features/portal-config/match'
import {
  listFileRequests,
  listForms,
  listPortalItems,
  listPortals,
  listResources,
  listSpeakers,
  listSubmissions,
  listTasksForEvent,
} from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'
import type { Portal, PortalContact, PortalFilters } from '@/types/portals'

/** One row of the list screen: the portal, and how many contacts currently land in it. */
export type PortalListEntry = { portal: Portal; matchedCount: number }

/** What the editor renders: the portal's own settings, and its four content cards. */
export type PortalEditorData = { portal: Portal; content: PortalContent }

/**
 * The list screen, in assignment order, with the matched-contact count per portal.
 *
 * **The count is the point of this read.** A filter that matches nobody is the failure mode
 * of this whole feature and it is invisible from the admin side, where a portal targeting
 * everybody and a portal targeting nobody render identically. The only person who otherwise
 * finds out is the speaker who never receives their tasks.
 *
 * It costs THREE reads for the whole screen, not one per portal, and that is deliberate.
 * `assignContacts` buckets every contact on the event in a single pass over an ordered
 * portal list, so ten portals cost exactly what one costs. A per-portal count query would
 * fan out against a 5 req/s base (§3.1) and would also be WRONG: assignment is first match
 * wins, so a portal's count depends on which contacts the portals above it already claimed,
 * which no per-portal query can see.
 *
 * The three lists are already read by the surfaces around this one, so they are warm.
 * `listSubmissions` carries its participants inline (`SubmissionWithParticipants`), which is
 * why there is no fourth read for the participant rows.
 */
export async function readPortalList(eventId: RecordId): Promise<readonly PortalListEntry[]> {
  const [portals, contacts] = await Promise.all([listPortals(eventId), eventContacts(eventId)])
  const buckets = assignContacts(portals, contacts)

  // `listPortals` sorts on `order` server-side, so the rows come back in the order the
  // matcher walks them. Re-sorting here would be a second opinion about assignment order
  // held by a module that cannot see the tie-break `match.ts` applies.
  return portals.map((portal) => ({
    portal,
    matchedCount: buckets.get(portal.id)?.length ?? 0,
  }))
}

/**
 * One portal's editor, or `undefined` when the id is not a portal on this event.
 *
 * `undefined` rather than a throw, because the caller is a page whose answer to an unknown
 * id is a 404, and it has to resolve that in its own BODY: `notFound()` from inside a
 * `<Suspense>` boundary answers HTTP 200 with the 404 body on Workers.
 *
 * The event check is made HERE as well as by the DAL's own event filter, for the reason
 * `features/resources/pages.ts` states: both sides of the join carry an event and only one
 * of them is filtered by the read. It is not the authorization, which is `ownedPortal` in
 * ./authorize.ts on every write.
 *
 * Resolved out of `listPortals` rather than `getPortal`, so opening the editor costs no
 * extra Airtable request beyond the list the surrounding screen already read.
 */
export async function readPortalEditor(
  eventId: RecordId,
  portalId: RecordId,
): Promise<PortalEditorData | undefined> {
  const portals = await listPortals(eventId)
  const portal = portals.find((row) => row.id === portalId && row.eventId === eventId)
  if (portal === undefined) return undefined

  // Five independent cached reads sharing one tag. In series they would each add a cold
  // round trip to a screen an organizer opens from a list they are already looking at.
  const [tasks, forms, fileRequests, resources, items] = await Promise.all([
    listTasksForEvent(eventId),
    listForms(eventId),
    listFileRequests(eventId),
    listResources(eventId),
    listPortalItems(eventId),
  ])

  return {
    portal,
    content: buildPortalContent(portal, { tasks, forms, fileRequests, resources }, items),
  }
}

/**
 * Who a filter set would match, for the create wizard's review step.
 *
 * **It deliberately ignores the other portals, and that is not the same question
 * `readPortalList` answers.** Here the organizer is asking "does this rule describe
 * anybody", before the portal exists and therefore before it has a position in the ordered
 * list. Running first-match-wins would subtract everybody an earlier portal already claimed,
 * so a perfectly good filter would preview as zero and the organizer would widen a rule that
 * was never the problem. Once the portal is saved, the list screen's count is the
 * first-match-wins number, and the two disagreeing is information rather than a bug.
 *
 * Returns the contacts themselves, not a count: §5.0c asks the review step to LIST the
 * matching contacts, and a filter that matches forty of the wrong people looks identical to
 * one that matches forty of the right ones when all you print is `40`.
 */
export async function readPortalMatchPreview(
  eventId: RecordId,
  filters: PortalFilters,
): Promise<readonly PortalContact[]> {
  const contacts = await eventContacts(eventId)
  return contacts.filter((contact) => matchesFilters(filters, contact))
}

/**
 * Every contact on the event, flattened into exactly what a filter can test.
 *
 * Shared by the two callers above so the count column and the preview cannot disagree about
 * who is a contact. Two reads in parallel, then pure array work: `buildPortalContacts` takes
 * no ids to look up, which is what keeps a 400-contact preview from being 400 lookups.
 *
 * Which submissions count is decided here, and the decision is to pass them ALL. `contacts.ts`
 * refuses to inspect `status` on purpose, because "everyone who has ever submitted" and
 * "confirmed speakers only" are both real portal audiences and a status rule baked into the
 * read would be invisible from the filter editor. An organizer who wants the narrower
 * audience writes a rule for it.
 */
async function eventContacts(eventId: RecordId): Promise<readonly PortalContact[]> {
  const [speakers, submissions] = await Promise.all([
    listSpeakers(eventId),
    listSubmissions(eventId),
  ])
  const participants = submissions.flatMap((submission) => submission.participants)
  return buildPortalContacts(eventId, speakers, submissions, participants)
}
