// The portal's user chip must not straddle an RSC boundary inside a Base UI `render` prop.
//
// It did, and the symptom was a React hydration error on every portal page. `PortalChrome`
// is a Server Component and it wrote `<DropdownMenuTrigger render={<Button .../>} />`
// inline. The trigger is a Client Component, so Flight had to serialize the `render` prop:
// it rendered `<Button>` on the server first and sent the RESULT, an element already
// carrying `data-slot="button"` in its props.
//
// Base UI then merges with `mergeProps(internalProps, render.props)`, rightmost wins, so
// `data-slot` came out `button`. But when that payload row is still blocked as the SSR pass
// consumes it, Flight hands back a `lazy` wrapper, and a lazy has no `.props`: Base UI's own
// lazy workaround (`internals/useRenderElement.js`) reads `render.props` BEFORE unwrapping,
// so the merge saw `undefined` and `data-slot` came out `dropdown-menu-trigger`. One pass
// each way, which is a hydration mismatch.
//
// Measured on a dev server at the time of the fix: with the boundary present the error fired
// on 2 of 5 loads of `/portal` (it depends on whether the Suspense boundary resolves before
// the shell flushes, so it is intermittent, which is exactly why it needs a static guard);
// with the menu moved behind `'use client'` it fired on 0 of 12.
//
// Nothing at runtime catches this. Vitest runs `environment: 'node'` with no renderer, the
// component renders fine either way, and only the wire format differs. So the assertable
// thing is the source: the menu keeps its own client boundary, and the server-rendered shell
// does not reach for a Base UI trigger directly.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

const USER_MENU = 'src/components/primitives/UserMenu.tsx'
const PORTAL_CHROME = 'src/components/shell/PortalChrome.tsx'

describe('the portal user menu', () => {
  it('declares its own client boundary', () => {
    expect(source(USER_MENU).startsWith("'use client'")).toBe(true)
  })

  it('owns the trigger, so the Button element is never serialized by Flight', () => {
    expect(source(USER_MENU)).toContain('DropdownMenuTrigger')
  })
})

describe('PortalChrome', () => {
  it('stays a Server Component', () => {
    expect(source(PORTAL_CHROME).startsWith("'use client'")).toBe(false)
  })

  it('delegates the chip rather than rendering a Base UI trigger itself', () => {
    const chrome = source(PORTAL_CHROME)
    expect(chrome).toContain('<UserMenu')
    expect(chrome).not.toContain('DropdownMenuTrigger')
  })

  it('passes no shadcn wrapper through a `render` prop', () => {
    // `render={<Button` and friends are the shape that breaks here. A Server Component may
    // still use `render={<Link` or `render={<a`: a host element carries no `data-slot` of
    // its own, so there is no prop for the merge order to flip.
    expect(source(PORTAL_CHROME)).not.toMatch(/render=\{\s*<[A-Z]/)
  })
})
