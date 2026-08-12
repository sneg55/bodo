// The event's own public site: which URLs resolve to which widget, and what they render under.
//
// The defect this covers is a routing one rather than a rendering one, so it is asserted at the
// routing layer. An eval run walked the deployment logged out and found that four of the five
// widget surfaces had no discoverable public path at all: `/sessions`, `/speakers`, `/gallery`,
// `/schedule`, `/itinerary`, `/program`, `/explore` and `/embeds` every one answered the app's
// 404 page, and only `/agenda/<slug>` was reachable without an organizer-issued opaque
// `/embed/<publicId>` link.
//
// Two properties matter and both are easy to lose later. Every EMBED VIEW must have a public
// address, or the gap reopens one view at a time. And an unknown segment must resolve to
// NOTHING, because the route turns that into a real 404: a segment that quietly fell back to the
// agenda would make every mistyped URL answer 200 with a duplicate of the schedule.

import { describe, expect, it } from 'vitest'

import {
  canonicalSurfaceSegment,
  type OpenCallForm,
  openCalls,
  PUBLIC_SITE_SURFACES,
  publicSiteEmbed,
  publicSitePath,
  publicSiteSurface,
  SUBMIT_ACTIVE,
  submitIndexPath,
} from '@/features/cms/public-site'
import { EMBED_VIEWS } from '@/types/cms'
import type { Event } from '@/types/domain'

describe('the public event site', () => {
  it('gives every embed view an address', () => {
    // The whole defect, as one assertion: a view with no surface is a widget a visitor can only
    // reach through a link an organizer has to hand them.
    const views = PUBLIC_SITE_SURFACES.map((surface) => surface.view).toSorted()

    expect(views).toEqual([...EMBED_VIEWS].toSorted())
  })

  it("marks My schedule as the visitor's own surface, and nothing else", () => {
    // The defect two eval agents filed: a nav item called `My schedule` landed on the ENTIRE
    // programme, with the visitor's starred sessions behind a toggle they had to find first.
    // `EmbedSurface` turns this flag into the star filter starting on, so the flag being on
    // exactly one surface is what keeps the promise the label makes.
    const personal = PUBLIC_SITE_SURFACES.filter((surface) => surface.personal === true)

    expect(personal.map((surface) => surface.segment)).toEqual(['schedule'])
    expect(publicSiteSurface('schedule')?.personal).toBe(true)
  })

  it('leaves every programme surface unmarked, including the one sharing its view', () => {
    // A pasted widget on the Schedule Itinerary view is an organizer putting the whole programme
    // on their own website, which is why this rides on the SURFACE and not on the view. The
    // agenda is the case worth naming: same rows, same stars, and it must still open on all of
    // them.
    for (const segment of ['', 'sessions', 'speakers', 'gallery']) {
      expect(publicSiteSurface(segment)?.personal).toBeUndefined()
    }
  })

  it('serves the agenda at the site index', () => {
    expect(publicSiteSurface('')?.view).toBe('agenda')
    expect(publicSitePath('ai-engineer-sandbox', '')).toBe('/agenda/ai-engineer-sandbox')
  })

  it('resolves each canonical segment to its own view', () => {
    expect(publicSiteSurface('sessions')?.view).toBe('session_list')
    expect(publicSiteSurface('schedule')?.view).toBe('schedule_itinerary')
    expect(publicSiteSurface('speakers')?.view).toBe('speaker_list')
    expect(publicSiteSurface('gallery')?.view).toBe('speaker_gallery')
    expect(publicSitePath('ai-engineer-sandbox', 'gallery')).toBe(
      '/agenda/ai-engineer-sandbox/gallery',
    )
  })

  it('answers the spellings a visitor actually tried', () => {
    // Every one of these was recorded as a 404 in the eval run. They resolve to a CANONICAL
    // segment rather than rendering, so each surface still has one address to bookmark.
    expect(canonicalSurfaceSegment('itinerary')).toBe('schedule')
    expect(canonicalSurfaceSegment('program')).toBe('')
    expect(canonicalSurfaceSegment('explore')).toBe('')
    expect(canonicalSurfaceSegment('widgets')).toBe('')
    expect(canonicalSurfaceSegment('embeds')).toBe('')
    expect(canonicalSurfaceSegment('talks')).toBe('sessions')
  })

  it('resolves a canonical segment to ITSELF, so it renders rather than redirecting', () => {
    for (const surface of PUBLIC_SITE_SURFACES) {
      expect(canonicalSurfaceSegment(surface.segment)).toBe(surface.segment)
    }
  })

  it('resolves nothing for a segment that is not a surface', () => {
    // The route turns undefined into `notFound()`. A fallback here would give an indexer as many
    // copies of the agenda as it could invent spellings.
    expect(canonicalSurfaceSegment('nonsense')).toBeUndefined()
    expect(publicSiteSurface('nonsense')).toBeUndefined()
    expect(canonicalSurfaceSegment('__proto__')).toBeUndefined()
    expect(canonicalSurfaceSegment('constructor')).toBeUndefined()
  })

  it('renders enabled, unfiltered, and with every optional field on', () => {
    const embed = publicSiteEmbed('agenda')

    // Enabled because the event's own pages have no switch: what gates them is the
    // published-and-approved rule inside `listPublishedAgenda`, same as every public surface.
    expect(embed.enabled).toBe(true)
    expect(embed.view).toBe('agenda')
    expect(embed.filters).toEqual({
      trackIds: [],
      roomIds: [],
      tagIds: [],
      formats: [],
      languages: [],
    })
    // An organizer's embed narrows to a slice that fits a column of their own site. This page is
    // ours and has the room, so nothing optional is switched off.
    expect(embed.fieldOptions.agenda).toContain('description')
    expect(embed.fieldOptions.speaker).toContain('about')
  })
})

// The call for papers, which had no index at all: `/submit` and `/submit/<slug>` both answered
// 404, so the wizard was reachable only by pasting the opaque `/submit/<slug>/<publicId>` link
// an organizer copies out of the builder. Two eval agents reported the headline feature of the
// product as undiscoverable, and the listing is what makes it findable, so the rule about WHICH
// forms it may list is the part worth pinning.

const EVENT: Pick<Event, 'id' | 'slug' | 'timezone'> = {
  id: 'ev1',
  slug: 'ai-engineer-sandbox',
  timezone: 'America/Los_Angeles',
}

const OPEN_FORM: OpenCallForm = {
  publicId: 'pub-1',
  name: 'Session Submission Form #4',
  externalTitle: 'Welcome to our event!',
  status: 'published',
  closeDate: '2026-09-16T06:59:00.000Z',
  eventId: 'ev1',
  kind: 'cfp',
}

const NOW = new Date('2026-08-08T12:00:00.000Z')

describe('the call for papers index', () => {
  it('lists an open form at the wizard address the organizer would have pasted', () => {
    expect(openCalls([OPEN_FORM], EVENT, NOW)).toEqual([
      {
        publicId: 'pub-1',
        title: 'Welcome to our event!',
        href: '/submit/ai-engineer-sandbox/pub-1',
        deadlineLine: 'Form submissions will be accepted until September 15 at 11:59 PM PDT.',
      },
    ])
  })

  it('falls back to the internal name when no external title is set', () => {
    // Every form that predates the column has it empty, and whitespace is the same thing. A
    // card headed by a blank is worse than one headed by the organizer's own name for it.
    expect(openCalls([{ ...OPEN_FORM, externalTitle: undefined }], EVENT, NOW).at(0)?.title).toBe(
      'Session Submission Form #4',
    )
    expect(openCalls([{ ...OPEN_FORM, externalTitle: '   ' }], EVENT, NOW).at(0)?.title).toBe(
      'Session Submission Form #4',
    )
  })

  it('carries no deadline line for a form with no close date', () => {
    expect(
      openCalls([{ ...OPEN_FORM, closeDate: undefined }], EVENT, NOW).at(0)?.deadlineLine,
    ).toBeUndefined()
  })

  it('lists nothing the wizard behind it would refuse', () => {
    // The whole reason the listing goes through `publicFormGate`: a form advertised here and
    // then rejected on arrival is worse than one that was never shown. Each of these is a gate
    // rejection reason, checked through the listing rather than through the gate directly.
    const refused: readonly OpenCallForm[] = [
      // Still a draft in the builder.
      { ...OPEN_FORM, publicId: 'draft', status: 'draft' },
      // Past its close date.
      { ...OPEN_FORM, publicId: 'expired', closeDate: '2026-01-01T00:00:00.000Z' },
      // A portal task form, which is not a public call for papers.
      { ...OPEN_FORM, publicId: 'task', kind: 'task' },
      // Linked to another event, whatever the listing that produced it thought.
      { ...OPEN_FORM, publicId: 'foreign', eventId: 'ev2' },
    ]

    expect(openCalls(refused, EVENT, NOW)).toEqual([])
  })

  it('keeps the index address out of the surface vocabulary', () => {
    // `SUBMIT_ACTIVE` marks the nav entry current on a page that is not a widget surface, so it
    // must never collide with one: a segment that resolved would highlight two links at once.
    expect(canonicalSurfaceSegment(SUBMIT_ACTIVE)).toBeUndefined()
    expect(submitIndexPath('ai-engineer-sandbox')).toBe('/submit/ai-engineer-sandbox')
  })
})
