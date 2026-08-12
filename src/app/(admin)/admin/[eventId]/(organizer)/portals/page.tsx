// /admin/[eventId]/portals
//
// THE ONE ROUTE BOTH ENTRIES RESOLVE TO. The Program tree's `Portals` and Event Settings >
// `Portals` both land here, per BUILD_SPEC 5.0c: two routes over one set of rows is how the
// two come to disagree about which portal claims a contact.
//
// The list is in ASSIGNMENT ORDER, because the order is load-bearing rather than cosmetic:
// a contact is assigned to the first portal they qualify for, so a list that hides the order
// hides the only thing deciding who lands where.
//
// One file, no `PortalsBody` child inside `<Suspense>`: `loading.tsx` is the route's
// boundary and the list is one read (`.claude/rules/bodo-conventions.md`).
//
// `+ Create Portal` IS behind its own boundary, and that is the one split that earns its
// keep here. The wizard needs three more reads than the list does (the event's contacts for
// the review step, its tracks and tags for the filter editor, and the default portal's
// content for the catalogue the content step starts from), and none of them is worth making
// the rows wait on. The fallback is the same button, disabled, so the header does not move.

import { DoorOpenIcon, Loader2Icon } from 'lucide-react'
import { Suspense } from 'react'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requireEventId } from '@/features/events/resolve-ref'
import { isEventOrganizer } from '@/features/portal-config/authorize'
import { CreateDefaultPortalButton } from '@/features/portal-config/CreateDefaultPortalButton'
import {
  readPortalEditor,
  readPortalList,
  readPortalMatchPreview,
} from '@/features/portal-config/reads'
import { listSpeakers, listTags, listTracks } from '@/services/airtable/queries'
import { EMPTY_PORTAL_FILTERS } from '@/types/portals'

import { CreatePortalWizard, type PortalPreviewContact } from './CreatePortalWizard'
import { PortalList } from './PortalList'

export const metadata = { title: 'Portals' }

export default async function PortalsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)

  // The layout redirects an unauthorized browser; this is not the security boundary. Every
  // portal write re-checks the role and the portal's event for itself (`authorize.ts`),
  // because a Server Action is reachable without this page ever rendering. BUILD_SPEC 4.
  if (!(await isEventOrganizer(eventId))) return null

  const entries = await readPortalList(eventId)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={DoorOpenIcon}
        title="Portals"
        description="Every contact lands in the first portal they match, in this order. Anyone who matches none lands on the default."
        actions={
          <Suspense fallback={<CreatePortalPlaceholder />}>
            <CreatePortalLauncher eventId={eventId} />
          </Suspense>
        }
      />

      {entries.length === 0 ? (
        <NoDefaultPortal eventId={eventId} />
      ) : (
        <PortalList
          eventId={eventId}
          rows={entries.map((entry) => ({
            id: entry.portal.id,
            name: entry.portal.name,
            kind: entry.portal.kind,
            isDefault: entry.portal.isDefault,
            matchedCount: entry.matchedCount,
          }))}
        />
      )}
    </div>
  )
}

/**
 * What sits in the header while the wizard's reads are in flight.
 *
 * It used to be `<Button disabled>+ Create Portal</Button>`, and the problem was not that it
 * was disabled, it was that nothing on it said so in any way an organizer reads. Its four
 * reads take seconds against Airtable on a cold cache, and a header button that is dead for
 * several seconds while looking like the button it will become is indistinguishable from a
 * broken one: it was clicked twice during testing with no response and no explanation.
 *
 * A spinner inside the same button, so the header still does not move, and an accessible
 * name that says what is happening rather than restating the label the icon sits next to.
 */
function CreatePortalPlaceholder() {
  return (
    <Button disabled aria-label="Loading Create Portal">
      <Loader2Icon className="animate-spin" />+ Create Portal
    </Button>
  )
}

/**
 * The wizard, with the three reads only it needs.
 *
 * The catalogue comes from the DEFAULT portal's editor data, because the four source lists
 * are the event's rather than any one portal's and `readPortalEditor` is the composed read
 * that already assembles them. The wizard resets every switch to the kind's untouched
 * default before rendering, so the default portal's own choices do not leak into a new one.
 *
 * Contacts are read with empty filters, which match everybody: the review step filters them
 * in the browser through the same `matchesFilters` the server matches with, so editing a
 * rule previews without a round trip.
 */
async function CreatePortalLauncher({ eventId }: { eventId: string }) {
  const [portals, tracks, tags, speakers, contacts] = await Promise.all([
    readPortalList(eventId),
    listTracks(eventId),
    listTags(eventId),
    listSpeakers(eventId),
    readPortalMatchPreview(eventId, EMPTY_PORTAL_FILTERS),
  ])

  const fallback = portals.find((entry) => entry.portal.isDefault)
  const editor =
    fallback === undefined ? undefined : await readPortalEditor(eventId, fallback.portal.id)
  const nameById = new Map(
    speakers.map((speaker) => [
      speaker.id,
      `${speaker.firstName} ${speaker.lastName}`.trim() === ''
        ? speaker.email
        : `${speaker.firstName} ${speaker.lastName}`.trim(),
    ]),
  )
  const preview: readonly PortalPreviewContact[] = contacts.map((contact) => ({
    contact,
    name: nameById.get(contact.speakerId) ?? contact.speakerId,
  }))

  return (
    <CreatePortalWizard
      eventId={eventId}
      tracks={tracks.map((track) => ({ id: track.id, name: track.name }))}
      tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
      contacts={preview}
      catalog={editor?.content ?? { task: [], form: [], file_request: [], resource: [] }}
    />
  )
}

/**
 * What an event with NO portal rows gets, and it is not "no portals yet".
 *
 * That copy was false in both directions. There is always a portal in force: nothing the
 * speaker portal reads consults the Portals table at all, so tasks, forms and file requests
 * follow the assignment and resource pages follow their `PortalItems` row, and every
 * contact lands on the same default experience whether or not a row exists to name it. And
 * the invitation to create one could not be taken up, because `savePortalAction` reads
 * `requireOneDefault` before it writes anything, so every create on an event with zero
 * defaults is refused. A screen telling an organizer that nothing exists, on a section
 * whose other five screens are full, is the one place the section explains itself.
 *
 * The state itself is a data fault rather than a step in a flow: §5.0c says the default
 * portal is created WITH the event, and both writers do it (`createDefaultPortal` in
 * features/events/actions.ts, `seedDefaultPortal` in scripts/seed). An event reaching this
 * card predates that or lost the row.
 *
 * **IT IS REPAIRED HERE NOW.** This card used to end by telling the organizer to add the row
 * in Airtable and wait a minute for the list to pick it up, which is a dead end wearing an
 * explanation: every event creator already writes this exact row, so the product knew how to
 * close the gap and asked the organizer to leave and do it by hand instead. Anyone without
 * access to the base, or without the schema in their head, had a screen with nothing to
 * press. The button writes the same row `createDefaultPortal` would have
 * (./CreateDefaultPortalButton.tsx, features/portal-config/repair-actions.ts).
 */
function NoDefaultPortal({ eventId }: { eventId: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <DoorOpenIcon className="size-6 text-muted-foreground" />
        <p className="font-medium">Every contact is on the default portal</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          This event has no default portal row, so there is nothing to list or reorder yet. Speakers
          still reach their portal: it shows the tasks, forms and file requests they are assigned,
          and the pages published under Resources.
        </p>
        <p className="max-w-prose text-sm text-muted-foreground">
          Assignment needs exactly one default to fall back to, so creating a portal is refused
          until this event has one.
        </p>
        <CreateDefaultPortalButton eventId={eventId} />
      </CardContent>
    </Card>
  )
}
