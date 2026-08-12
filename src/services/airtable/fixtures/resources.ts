// Fixture resource pages and their PortalItems rows: what R8 renders with no base.
//
// Its own file rather than more of portal.ts, for the line limit. See event.ts for what
// fixtures are for and why the ids read `fix...` rather than `rec...`.
//
// Deliberately not degenerate, for the same reason the other fixture sets are not. The
// three rows below cover the three states the portal has to be able to render: a published
// page with an embed, a published page that is markdown only, and a DRAFT (its portal item
// is disabled) which must never appear in the portal even though it appears in the admin
// list. Without that third row a clone cannot demonstrate the visibility rule at all.
//
// The embed is a plain `<iframe>` to a real map, which is the shape of the thing an
// organizer actually pastes, and it exercises the nested-frame case: the outer sandbox
// flags are inherited by anything the embed loads.

import type { PortalItem, Resource } from '@/types/resources'

export const FIXTURE_RESOURCES: readonly Resource[] = [
  {
    id: 'fixRes1',
    eventId: 'fixEvent1',
    title: 'Venue and travel',
    slug: 'venue-and-travel',
    bodyMarkdown: [
      '# Getting to the venue',
      '',
      'The sandbox runs at **Pier 27**, San Francisco. Doors open at 08:30 each day.',
      '',
      '- The 3rd Street light rail stops two blocks away',
      '- Parking is on Embarcadero, and it fills by 09:00',
      '',
      'Questions? Email [the speaker desk](mailto:speakers@example.com).',
    ].join('\n'),
    embedHtml:
      '<iframe title="Venue map" width="100%" height="380" style="border:0" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=-122.402%2C37.799%2C-122.394%2C37.804"></iframe>',
    visibility: 'portal',
    order: 1,
  },
  {
    id: 'fixRes2',
    eventId: 'fixEvent1',
    title: 'Speaker guide',
    slug: 'speaker-guide',
    bodyMarkdown: [
      '## Before you arrive',
      '',
      '1. Upload your headshot and slides from the Tasks page',
      '2. Check your session time on the agenda',
      '',
      '> Slides are due 48 hours before your session.',
      '',
      'The stage laptop runs Chrome. Bring `HDMI` and `USB-C` adapters.',
    ].join('\n'),
    visibility: 'public',
    order: 2,
  },
  {
    // A draft: its portal item is disabled, so no speaker may see it. The admin list
    // shows it, which is what makes the two lists distinguishable in a demo.
    id: 'fixRes3',
    eventId: 'fixEvent1',
    title: 'Green room notes (draft)',
    slug: 'green-room-notes',
    bodyMarkdown: 'Not finished yet.',
    visibility: 'portal',
    order: 3,
  },
]

export const FIXTURE_PORTAL_ITEMS: readonly PortalItem[] = [
  {
    id: 'fixItem1',
    eventId: 'fixEvent1',
    itemType: 'resource',
    resourceId: 'fixRes1',
    enabled: true,
    order: 1,
  },
  {
    id: 'fixItem2',
    eventId: 'fixEvent1',
    itemType: 'resource',
    resourceId: 'fixRes2',
    enabled: true,
    order: 2,
  },
  {
    id: 'fixItem3',
    eventId: 'fixEvent1',
    itemType: 'resource',
    resourceId: 'fixRes3',
    enabled: false,
    order: 3,
  },
]
