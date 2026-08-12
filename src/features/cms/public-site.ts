// The event's own public website: which surfaces it has, and what an embed record would have to
// say to produce each one.
//
// WHY THIS EXISTS. The five widget views were reachable at exactly one address each, and only
// through an opaque `/embed/<publicId>` an organizer had to hand out: `/agenda/<slug>` was a
// static stack of day sections, and `/sessions`, `/speakers`, `/gallery`, `/schedule` and every
// other guess answered the app's 404 page. So four of the five widgets a visitor could be shown
// had no discoverable public path at all, and the one that did was inert next to them.
//
// The fix is not a sixth rendering of the same rows. A public surface IS an embed, minus the
// organizer's per-embed configuration: same projection, same visibility rule, same layouts, same
// visitor controls (@/features/cms/EmbedSurface). What this module supplies is the configuration
// an embed record would have carried, with the defaults chosen below, and the vocabulary of URL
// segments that names each one.
//
// THE DEFAULTS ARE STATED AND EACH HAS A REASON:
//
//   - `enabled: true`. There is no switch to read: the event's own pages are not something an
//     organizer created and can disable. What gates them is the same thing that gates every
//     other public surface, the published-and-approved rule inside `listPublishedAgenda`.
//   - No filters at all. An embed narrows to a slice an organizer wants on one page of their
//     site; the event's own programme is the whole thing, and the visitor narrows it themselves
//     with the search box and the facet panel.
//   - Every optional field on (`defaultEmbedFieldOptions`). Field Options exist so an embed can
//     be made to fit a column in somebody else's layout. This page is ours and has the room.
//   - The captured Style Options defaults (`EMBED_DEFAULTS`), including `en_us_long` dates, which
//     is what `/agenda/<slug>` printed before this existed: becoming interactive did not silently
//     restyle every date on the page.

import { defaultEmbedFieldOptions } from '@/features/cms/field-options'
import type { EmbedProjectionEmbed } from '@/features/cms/projection'
import { deadlineSentence } from '@/features/submissions/banner'
import { publicFormGate } from '@/features/submissions/gate'
import { EMBED_DEFAULTS, type EmbedView } from '@/types/cms'
import type { Event } from '@/types/domain'
import type { Form } from '@/types/forms'

/** One page of the public event site. */
export type PublicSiteSurface = {
  /** The URL segment under `/agenda/<slug>`. Empty for the site's own index. */
  segment: string
  /** The tab label. Sentence case, matching the rest of the public chrome. */
  label: string
  /** The `<title>`, and what a search result would read. */
  title: string
  view: EmbedView
  /**
   * Does this page show the visitor's OWN picks rather than the programme?
   *
   * Set on `schedule` and on nothing else. `My schedule` is the only nav item here that names
   * the visitor rather than the event, and it landed on the entire programme with the starred
   * sessions behind a toggle they had to find first: two eval agents followed it and reported
   * exactly that. `EmbedSurface` turns this into the star filter starting on.
   *
   * Optional and `true`-only, so the surface table stays a list of what each page IS and the
   * four programme surfaces say nothing at all. A pasted widget on the same Schedule Itinerary
   * view is an organizer putting the whole programme on their own site, which is why this lives
   * on the surface rather than on the view.
   */
  personal?: true
}

/**
 * The five surfaces, in the order the nav lists them.
 *
 * One per embed VIEW, which is the point: every widget an organizer can paste into their own
 * site is also a page of the event's own site, so none of them is reachable only through an
 * opaque link. The order runs schedule-first because that is what a visitor arrives for.
 */
export const PUBLIC_SITE_SURFACES: readonly PublicSiteSurface[] = [
  { segment: '', label: 'Agenda', title: 'Agenda', view: 'agenda' },
  { segment: 'sessions', label: 'Sessions', title: 'Sessions', view: 'session_list' },
  {
    segment: 'schedule',
    label: 'My schedule',
    title: 'My schedule',
    view: 'schedule_itinerary',
    personal: true,
  },
  { segment: 'speakers', label: 'Speakers', title: 'Speakers', view: 'speaker_list' },
  { segment: 'gallery', label: 'Gallery', title: 'Speaker gallery', view: 'speaker_gallery' },
]

/**
 * Spellings that resolve to a surface without being its own address.
 *
 * Transcribed from nothing: this is the list of paths a first-time visitor and an indexer
 * actually tried and got a 404 from. `itinerary` and `program` are what the two schedule-shaped
 * surfaces are called in half the conference world, and answering them costs one map entry
 * rather than a support question. Each redirects to the canonical segment above rather than
 * rendering, so there is one address per surface for a search engine to settle on.
 */
const SURFACE_ALIASES: ReadonlyMap<string, string> = new Map([
  ['agenda', ''],
  ['program', ''],
  ['programme', ''],
  ['explore', ''],
  // `widgets` and `embeds` were tried by somebody who knew the feature's internal name. The
  // site index is the honest answer: it is every widget surface, as pages.
  ['widgets', ''],
  ['embeds', ''],
  ['itinerary', 'schedule'],
  ['my-schedule', 'schedule'],
  ['talks', 'sessions'],
  ['speaker-gallery', 'gallery'],
])

/** The canonical segment a spelling names, or `undefined` when it names nothing. */
export function canonicalSurfaceSegment(spelling: string): string | undefined {
  const alias = SURFACE_ALIASES.get(spelling)
  if (alias !== undefined) return alias
  return PUBLIC_SITE_SURFACES.some((surface) => surface.segment === spelling) ? spelling : undefined
}

/**
 * The surface one URL segment renders, or `undefined` for a segment that is not one.
 *
 * `undefined` and not a fallback to the agenda, because the caller turns it into `notFound()`:
 * a mistyped path that quietly rendered the agenda would make every wrong URL answer 200, and
 * an indexer would then hold as many copies of the agenda as it could invent segments.
 */
export function publicSiteSurface(segment: string): PublicSiteSurface | undefined {
  const canonical = canonicalSurfaceSegment(segment)
  if (canonical === undefined) return undefined
  return PUBLIC_SITE_SURFACES.find((surface) => surface.segment === canonical)
}

/** Where one surface lives. The site index has no trailing segment. */
export function publicSitePath(eventSlug: string, segment: string): string {
  return segment === '' ? `/agenda/${eventSlug}` : `/agenda/${eventSlug}/${segment}`
}

// THE CALL FOR PAPERS, which is the sixth public page and is not a widget view.
//
// It is deliberately NOT an entry in PUBLIC_SITE_SURFACES: that list is one surface per embed
// view and a test pins it to exactly the view vocabulary, because a view without an address is
// how four of the five became unreachable. A CFP renders no embed projection at all.
//
// WHY IT EXISTS. Two eval agents independently reported that nothing in the public site or the
// speaker portal links to the open call for papers, and there was no page to link to: the only
// route under `/submit` was `[eventSlug]/[formPublicId]`, so `/submit` and `/submit/<slug>` both
// answered 404 and the wizard was reachable only by pasting an opaque per-form link an organizer
// had to hand out. The headline feature of the product was undiscoverable.

/**
 * The nav label, and the `active` value the call-for-papers page passes.
 *
 * `Submit a session` rather than `Call for papers` because it names the action rather than the
 * artifact, and it is the phrase the wizard's own tab title carried before this existed.
 */
export const SUBMIT_LABEL = 'Submit a session'

/** The `active` value for the CFP page. Not a surface segment, so no surface can claim it. */
export const SUBMIT_ACTIVE = 'submit'

/** The event's call-for-papers index. */
export function submitIndexPath(eventSlug: string): string {
  return `/submit/${eventSlug}`
}

/** One open call for papers, as the index lists it. */
export type OpenCall = {
  publicId: string
  /** The participant-facing title, falling back to the internal name. */
  title: string
  /** `/submit/<slug>/<publicId>`: the wizard's own address, unchanged. */
  href: string
  /** The pre-rendered deadline sentence, in the EVENT's zone. Absent with no close date. */
  deadlineLine?: string
}

/** Everything the listing reads off a form. A `Form` satisfies it; nothing wider is needed. */
export type OpenCallForm = Pick<
  Form,
  'publicId' | 'name' | 'externalTitle' | 'status' | 'closeDate' | 'eventId' | 'kind'
>

/**
 * Which of an event's forms a stranger may open right now.
 *
 * The predicate is `publicFormGate` itself and not a second reading of `status` and
 * `closeDate`. That is the whole point of routing it through the gate: the index cannot list a
 * form that `/submit/<slug>/<publicId>` then refuses, and a draft or expired form cannot leak
 * onto a public page because somebody added a third opinion about what "open" means.
 *
 * Pure, so the rule is tested without a request scope. The caller supplies the forms.
 */
export function openCalls(
  forms: readonly OpenCallForm[],
  event: Pick<Event, 'id' | 'slug' | 'timezone'>,
  now: Date,
): readonly OpenCall[] {
  return forms
    .filter((form) => publicFormGate({ form, event, eventSlug: event.slug, now }).open)
    .map((form) => ({
      publicId: form.publicId,
      title: callTitle(form),
      href: `${submitIndexPath(event.slug)}/${form.publicId}`,
      deadlineLine:
        form.closeDate === undefined
          ? undefined
          : deadlineSentence(form.closeDate, event.timezone, now),
    }))
}

/**
 * `externalTitle` is what a stranger reads; `name` is what an organizer searches by. Every form
 * that predates the column has the first one empty, and a whitespace-only value is the same
 * thing, so both fall back rather than heading a card with a blank.
 */
function callTitle(form: Pick<OpenCallForm, 'externalTitle' | 'name'>): string {
  const external = (form.externalTitle ?? '').trim()
  return external.length === 0 ? form.name : external
}

/**
 * The embed configuration a public surface renders under.
 *
 * A real `CmsEmbed` shape rather than a second projection path, so the event's own pages and a
 * pasted widget provably render the same markup from the same rows: one of them going stale is
 * exactly how the public agenda ended up with no search box while the embed beside it had one.
 */
export function publicSiteEmbed(view: EmbedView): EmbedProjectionEmbed {
  return {
    enabled: true,
    view,
    // The captured embed defaults, whole. `EmbedFrame`'s coloured band is not rendered on this
    // site at all, so `primaryColor` reaches nothing here; naming the same constant an embed
    // starts life with is still the honest value, and it stops this drifting into a second
    // definition of "default" that only one of the two surfaces follows.
    ...EMBED_DEFAULTS,
    filters: { trackIds: [], roomIds: [], tagIds: [], formats: [], languages: [] },
    fieldOptions: defaultEmbedFieldOptions(),
  }
}
