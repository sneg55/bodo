// The Today tab's sub-tab strip, ref 34: Submission Forms, Participants, Evaluations,
// Agenda.
//
// Routed, not client state, because the reference is explicit about it: ref 37 captures
// `appv2.sessionboard.com/event/6703/dashboard/evaluations` in the address bar. So each
// sub-tab is a URL a bookmark and a Back button can hold, and the strip is `Tabs` whose
// triggers are links.
//
// The slugs ARE the parity target, which is why they are pinned in a test rather than
// spelled at the two call sites: `/dashboard/evaluations` is the observed one and the other
// three follow its shape.
//
// Data-only, with no icon imports and no JSX, so both the route and the strip read the same
// list and neither can drift the labels or the order.

export const HOME_TABS = [
  { id: 'submission-forms', label: 'Submission Forms' },
  { id: 'participants', label: 'Participants' },
  { id: 'evaluations', label: 'Evaluations' },
  { id: 'agenda', label: 'Agenda' },
] as const

export type HomeTab = (typeof HOME_TABS)[number]['id']

/** The tab the bare event home shows, which is the one selected in ref 34. */
export const DEFAULT_HOME_TAB: HomeTab = 'submission-forms'

/**
 * Where a sub-tab lives.
 *
 * The default tab keeps the bare `/admin/{eventId}` URL rather than getting a
 * `/dashboard/submission-forms` of its own, because that URL is what the sidebar's Dashboard
 * item points at and what every existing link into the event home uses. The route below it
 * still ACCEPTS the explicit slug so a typed or shared URL resolves; it just is not the one
 * the strip links to.
 */
export function homeTabHref(eventId: string, tab: HomeTab): string {
  return tab === DEFAULT_HOME_TAB ? `/admin/${eventId}` : `/admin/${eventId}/dashboard/${tab}`
}

/** A URL segment to a tab, or `undefined` so the route can 404 instead of guessing. */
export function homeTabFromSlug(slug: string): HomeTab | undefined {
  return HOME_TABS.find((tab) => tab.id === slug)?.id
}
