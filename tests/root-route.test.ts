// The root URL, and the rule that keeps it working on Workers.
//
// WHAT CHANGED, because the earlier version of this file pinned the opposite behaviour and it is
// worth saying why rather than quietly deleting the assertion. `/` used to `redirect('/login')`
// unconditionally, on the stated grounds that "every surface behind `/` is either an organizer's
// admin tree or a speaker's portal". That stopped being true when the event's public site was
// built. An eval run walked the deployment logged out and filed it as major: the root sent an
// anonymous visitor to a sign-in form, nothing anywhere linked to a public page, and four of the
// five public widget surfaces had no discoverable path at all. So the root now NAMES both doors,
// the public programme and sign-in, and takes neither on the visitor's behalf.
//
// WHAT DID NOT CHANGE is the reason this file exists. Whatever `/` decides, it has to decide it
// in the page BODY, before the first byte. On Workers a `redirect()` or a `notFound()` reached
// from inside a `<Suspense>` boundary resolves after the shell has flushed: the redirect never
// produces a response and the runtime cancels the request, and the `notFound()` answers HTTP 200
// carrying the 404 body. Neither shows up in `next build` and neither shows up in a test that
// renders the page, which is why the absence of a boundary is asserted against the SOURCE.

import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('the root route', () => {
  it('offers the sign-in door', async () => {
    const source = await readFile('src/app/page.tsx', 'utf8')

    expect(source).toContain('/login')
  })

  it('offers the public event site, which is the half that used to be unreachable', async () => {
    const source = await readFile('src/app/page.tsx', 'utf8')

    // Both, and not just a hardcoded `/agenda/...`: the surface table is what the nav, the
    // sitemap and the root all read, so a sixth surface added there appears here too.
    expect(source).toContain('PUBLIC_SITE_SURFACES')
    expect(source).toContain('publicSitePath')
  })

  it('decides everything in the page body, not inside a boundary', async () => {
    const source = await readFile('src/app/page.tsx', 'utf8')
    const body = source.slice(source.indexOf('export default async function Home()'))

    // A `<Suspense>` here would put the reads, and anything they decide, after the shell has
    // flushed. There is nothing on this page worth streaming: it is one cached record read.
    expect(body).not.toContain('Suspense')
  })

  it('has no loading.tsx above it, which would be exactly such a boundary', async () => {
    // The admin tree keeps its loading.tsx files deliberately and pays a known cost for them
    // (an admin route with a bogus id answers 200 with the 404 body). The root cannot: adding
    // one would wrap this page in a boundary and defeat the rule above from outside the file.
    await expect(access('src/app/loading.tsx')).rejects.toThrow()
  })
})
