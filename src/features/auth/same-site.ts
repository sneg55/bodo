// Refuses a state-changing GET that did not start on this site.
//
// `/logout` and `/admin-mode` both change the session on a GET, which is the wrong shape and
// is kept only because signing out has to work with scripting off (BUILD_SPEC 4). The cookie
// is `SameSite=Lax`, which withholds it from a cross-site subresource but SENDS it on a
// cross-site top-level navigation. So a link or a redirect from another origin could sign a
// person out, or push an impersonated organizer back into admin mode, without them choosing
// it. Found by Codex review, which also noted Next answers HEAD by running GET when no HEAD
// handler is exported, so a credentialed link scanner or preview fetch can do the same.
//
// `Sec-Fetch-Site` is what distinguishes them, and it is set by the browser rather than by
// the page, so it cannot be spoofed from script. Chrome, Firefox and Safari all send it on
// navigations.
//
// This is a mitigation and not the proper fix, which is to make both endpoints POST with
// Origin validation. That is what Next recommends and it would work without scripting via a
// plain form. It is not done here only because it changes two controls and a route shape
// late in the build; the endpoints are recorded in the notes as owing it.
//
// ABSENT is allowed through deliberately. A client old enough not to send the header would
// otherwise be unable to sign out at all, and refusing a sign-out is its own harm: the
// failure mode of allowing it is that a browser which never sends the header can be made to
// log a person out, and the failure mode of refusing it is that such a browser can never log
// out. Being unable to end a session is worse than ending one unexpectedly.

/**
 * The only values allowed for a state-changing GET.
 *
 * `same-site` is deliberately NOT here, and that is the correction worth recording:
 * SameSite protects SITES rather than origins, so a different origin on the same
 * registrable domain both carries the Lax cookie and reports `same-site`. Allowing it would
 * have left the hole this exists to close open to any sibling subdomain. Nothing in this app
 * links to either endpoint from another origin, so the stricter set costs nothing.
 */
const ALLOWED = ['same-origin', 'none']

/**
 * True when a state-changing GET may proceed.
 *
 * `none` is included because it is what a browser reports for a navigation the USER started
 * outside any page context: typing the URL, or a bookmark. That is a deliberate act by the
 * person whose session it is, which is exactly what this is protecting.
 */
export function startedOnThisSite(request: {
  headers: { get: (name: string) => string | null }
}): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site === null || site === '') return true
  return ALLOWED.includes(site)
}
