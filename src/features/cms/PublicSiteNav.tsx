// The public site's surface nav: five links, one per widget view.
//
// A row of links and not a `Tabs` strip, and that is the point rather than a shortcut. Each
// surface is its own URL, so a visitor can bookmark the speaker gallery and a search engine can
// index the session list; a tab strip would make four of the five states of one page again,
// which is the shape that left them undiscoverable in the first place.
//
// `ButtonLink` and not `Button`, per the primitive's own rule: use `Button` for anything that
// RUNS code and this for anything that GOES somewhere. It also carries the pending state, which
// earns its keep here more than anywhere: each surface is a dynamic route that reads Airtable,
// so a visitor moving from the agenda to the gallery gets a spinner instead of a page that looks
// unchanged for a second and invites a second click.
//
// The active one is `secondary` rather than carrying its own colour, so the highlight comes from
// the token layer and survives dark mode.

import { ButtonLink } from '@/components/primitives/ButtonLink'
import {
  PUBLIC_SITE_SURFACES,
  publicSitePath,
  SUBMIT_ACTIVE,
  SUBMIT_LABEL,
} from '@/features/cms/public-site'

export function PublicSiteNav({
  eventSlug,
  active,
  submitHref,
}: {
  eventSlug: string
  /**
   * The canonical segment of the surface being rendered. Empty string for the agenda, and
   * `SUBMIT_ACTIVE` on the call-for-papers page, which is not a surface.
   */
  active: string
  /**
   * Where the call for papers lives, or `undefined` when the event has none open.
   *
   * Passed in rather than derived here, because "is anything open" is a read and this is the
   * chrome. Absent draws NO link at all: a Submit a session button leading to a page saying
   * submissions are closed is worse than no button, and the caller already knows the answer.
   */
  submitHref?: string
}) {
  return (
    // `aria-label` because there is a second navigation on the page in the visitor's mind (the
    // day tabs inside the widget), and "navigation" twice tells a screen reader nothing.
    <nav aria-label="Event pages" className="flex flex-wrap items-center gap-1">
      {PUBLIC_SITE_SURFACES.map((surface) => (
        <ButtonLink
          key={surface.segment}
          size="sm"
          variant={surface.segment === active ? 'secondary' : 'ghost'}
          href={publicSitePath(eventSlug, surface.segment)}
          aria-current={surface.segment === active ? 'page' : undefined}
        >
          {surface.label}
        </ButtonLink>
      ))}

      {/* The call for papers, filled rather than ghost, and last rather than folded into the
          row above. It is the one thing on this site a visitor can DO, the other five are
          things to read, and it was reachable only through a link an organizer had to hand
          out. `ms-auto` pushes it to the end of the row where there is space to, and lets it
          wrap onto its own line when there is not. */}
      {submitHref === undefined ? null : (
        <ButtonLink
          size="sm"
          className="ms-auto"
          href={submitHref}
          aria-current={active === SUBMIT_ACTIVE ? 'page' : undefined}
        >
          {SUBMIT_LABEL}
        </ButtonLink>
      )}
    </nav>
  )
}
