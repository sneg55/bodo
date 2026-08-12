'use server'

// Creating an event.
//
// **What authorizes this.** `requireAdminUser()`, and nothing narrower, because there is no
// event to hold a role on yet: `requireEventRole` needs an id that does not exist until
// this function has run. So the gate is "a signed-in organizer account", which is the same
// gate `/admin` uses to decide whether to show anybody anything. That is a deliberate
// policy and worth naming: any admin user can create an event, and becomes its sole admin.
// There is no organization or tenant record above Events in this schema (BUILD_SPEC 2) to
// scope it more tightly, so inventing an approval step here would be inventing a table.
//
// **Three writes, not one, and the order is the safe one.** Airtable has no transaction, so
// the event row, its default portal and the membership that grants access to it cannot land
// together. The event goes first: the other order would point a membership or a portal at a
// record that does not exist, which every lookup downstream would then have to survive.
//
// The DEFAULT PORTAL goes second, before the membership, and that ordering is a decision
// rather than an accident. BUILD_SPEC 5.0c requires exactly one default per event and says
// it "is created with the event so a portal can never have nowhere to fall back to": an
// event with none is a state `matchPortal` answers `undefined` for, so every contact lands
// nowhere, and `savePortalAction` REFUSES to write while the count is not exactly one, so
// an organizer cannot repair it from inside the product. Granting access last means the only
// half-created state anybody can reach is the one this file already accepted, an event
// nobody can open, which is invisible and recoverable. Access to a live event whose portals
// can never be edited is neither.
//
// Every failure is reported with the orphan's id rather than swallowed, because that id is
// the only way anyone will find it again.
//
// Validation runs here as well as in the form for the usual reason: an action is reachable
// by POST without the page ever rendering.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireAdminUser } from '@/features/auth/wiring'
import { type EventChoice, eventChoices } from '@/features/events/choices'
import { NEW_EVENT_STATUS } from '@/features/events/create'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { checkEventDetails, hasBlockingProblem } from '@/features/settings/checks'
import {
  EVENT_TYPE_OPTIONS,
  type EventDetailsDraft,
  toEventDetailsWrite,
} from '@/features/settings/draft'
import { createEvent } from '@/services/airtable/mutations-event'
import { createPortal } from '@/services/airtable/mutations-portals'
import { createEventMembership } from '@/services/airtable/mutations-team'
import { getEvent, listMembershipsForUser } from '@/services/airtable/queries'
import { EMPTY_PORTAL_FILTERS } from '@/types/portals'

/**
 * The events this organizer can switch to.
 *
 * An action rather than a prop on `AdminSidebarSlot`, for the reason the ⌘K palette gives
 * at length in `src/features/search/actions.ts`: the sidebar renders on every admin page,
 * and reading one record per membership there would put that cost, and that much serialized
 * payload, on every page load to populate a dialog most visits never open. Opening the
 * switcher is the moment it is worth paying for.
 *
 * `requireAdminUser` and not `requireEventRole`: the question is which events this user
 * holds, which is not scoped to any one of them. The memberships read IS the authorization,
 * since an event with no membership never enters the list.
 */
export async function listEventChoicesAction(): Promise<
  ActionResult<{ choices: readonly EventChoice[] }>
> {
  try {
    const { userId } = await requireAdminUser()
    const memberships = await listMembershipsForUser(userId)
    const events = await Promise.all(
      memberships.map(async (membership) => await getEvent(membership.eventId)),
    )
    return actionOk({ choices: eventChoices(events, memberships) })
  } catch (error) {
    return actionFailure(error)
  }
}

export type CreateEventResult = {
  /** Where the caller navigates next. The new event's admin home. */
  eventId: string
  slug: string
}

export async function createEventAction(input: {
  draft: EventDetailsDraft
}): Promise<ActionResult<CreateEventResult>> {
  try {
    const { userId } = await requireAdminUser()

    const problems = checkEventDetails(input.draft)
    if (hasBlockingProblem(problems)) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        problems.map((problem) => problem.message).join(' '),
        {},
      )
    }

    // Checked here rather than in `checkEventDetails`, which is pure over the draft and has
    // no business knowing the base's select vocabulary. Same rule as the settings action.
    if (!EVENT_TYPE_OPTIONS.includes(input.draft.eventType)) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        `${input.draft.eventType} is not one of the event types this base accepts.`,
        {},
      )
    }

    const event = await createEvent({
      write: toEventDetailsWrite(input.draft),
      status: NEW_EVENT_STATUS,
    })

    await createDefaultPortal(event.id)
    await grantCreatorAdmin({ eventId: event.id, userId })

    return actionOk({ eventId: event.id, slug: event.slug })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * The portal every contact falls back to, created with the event. BUILD_SPEC 5.0c.
 *
 * Named for what this product calls the surface in its own copy: the CFP wizard, the success
 * card and the root metadata all say "your speaker portal", and the admin bar's button says
 * `View Portal`. An organizer renaming it later is an ordinary edit; inventing a different
 * word here would mean the one portal every event has is the one thing nothing else in the
 * product refers to by name.
 *
 * No filters, `isDefault` set, position 0. It is the "everyone else" bucket by definition, so
 * `firstMatch` never treats it as a candidate and its filters would be ignored even if it had
 * any (`match.ts`). Position 0 is presentational for the same reason, and it is where
 * `savePortalAction` pins it.
 *
 * The two switches start OFF, which is the schema's own default rather than a policy: an
 * organizer turns on `Always Show Tasks` and `Manage Profile` when they want them, and a
 * portal that silently arrived with capabilities enabled is a portal nobody chose to grant.
 *
 * A failure here aborts before the membership is granted, so the creator never gains access
 * to an event whose portals they could not then edit. The message names the record because
 * Airtable is the only place a missing default row can now be added.
 */
async function createDefaultPortal(eventId: string): Promise<void> {
  try {
    await createPortal({
      eventId,
      name: 'Speaker Portal',
      kind: 'contacts',
      isDefault: true,
      order: 0,
      filters: EMPTY_PORTAL_FILTERS,
      alwaysShowTasks: false,
      manageProfile: false,
    })
  } catch (cause) {
    throw new AppError(
      ErrorIds.DATA_WRITE_FAIL,
      `The event was created but its default speaker portal was not, so it has been left without access. Its record id is ${eventId}; add a default portal to it in Airtable, or delete it and try again.`,
      { eventId, cause: cause instanceof Error ? cause.message : String(cause) },
    )
  }
}

/**
 * Make the creator an admin on what they just created.
 *
 * Wrapped so the failure can say which record was left behind. Without the id in the
 * message the event is unreachable: it holds a slug, so a retry with the same name is
 * refused as a collision, and nothing in the product lists events the caller has no
 * membership on. Naming it turns a dead end into something recoverable from Airtable.
 */
async function grantCreatorAdmin(input: { eventId: string; userId: string }): Promise<void> {
  try {
    await createEventMembership({
      eventId: input.eventId,
      userId: input.userId,
      role: 'admin',
      addedAt: new Date().toISOString(),
    })
  } catch (cause) {
    throw new AppError(
      ErrorIds.DATA_WRITE_FAIL,
      `The event was created but access could not be granted. Its record id is ${input.eventId}; add yourself to it in Airtable.`,
      // `AppError` has no `cause` parameter, so the underlying reason rides in context,
      // where `toLogLine` will print it. Losing it would leave the operator with an
      // orphaned event and no idea why the second write failed.
      {
        eventId: input.eventId,
        userId: input.userId,
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    )
  }
}
