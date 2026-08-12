// The Today tab's sub-tab strip, ref 34.
//
// `Tabs` from the design system rather than a hand-rolled strip, which is also lint-enforced
// (`role="tablist"` written by hand is an ESLint error): the primitive owns the roles, the
// arrow-key behaviour and the active indicator.
//
// Each trigger IS a link, because these sub-tabs are routes (ref 37 captures
// `/dashboard/evaluations` in the address bar), so the strip works with a Back button, a
// bookmark and a middle-click. `nativeButton={false}` because the rendered element is an
// anchor and not a button, the same shape `Button` uses for a link everywhere else in this
// codebase. `value` is controlled by the URL and there is no `onValueChange`: navigation is
// what changes the tab, so nothing here holds a second copy of that state.

import Link from 'next/link'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HOME_TABS, type HomeTab, homeTabHref } from '@/features/dashboard/sub-tabs'

export function SubTabs({ eventId, active }: { eventId: string; active: HomeTab }) {
  return (
    <Tabs value={active}>
      <TabsList variant="line">
        {HOME_TABS.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            nativeButton={false}
            render={<Link href={homeTabHref(eventId, tab.id)} />}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
