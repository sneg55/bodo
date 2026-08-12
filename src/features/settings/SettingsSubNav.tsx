'use client'

// The settings sub-navigation column (docs/parity/event-config.md ref 02).
//
// A client component because the selection comes from the pathname. The tree itself is
// data in `nav.ts`, so this file owns appearance and nothing else, and the Overview page
// renders the same labels server side from the same source.
//
// Library is a `Collapsible` with its open state controlled here, so the chevron rotation
// reads off state rather than off a data attribute on an ancestor. It is the last disclosure
// in the admin chrome: the sidebar's own trees were flattened on 2026-08-10 (see
// `admin-nav-sections.ts`), and this one survives because Fields and Tags are genuinely
// children of Library rather than a container invented over a flat list. It starts open,
// which is the state ref 02 captures, and it is forced open
// while one of its children is selected: a selected item hidden inside a collapsed group
// is a nav that looks like nothing is selected at all.

import { ChevronDownIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  activeSettingsId,
  isLibraryActive,
  type SettingsNavLeaf,
  settingsNav,
} from '@/features/settings/nav'
import { cn } from '@/utils/cn'

export function SettingsSubNav({ eventId }: { eventId: string }) {
  const pathname = usePathname()
  const active = activeSettingsId(pathname, eventId)
  const [libraryExpanded, setLibraryExpanded] = useState(true)
  const libraryOpen = libraryExpanded || isLibraryActive(pathname, eventId)

  return (
    <nav aria-label="Event Settings sections" className="flex w-full flex-col gap-0.5 lg:w-56">
      {settingsNav(eventId).map((entry) =>
        entry.kind === 'leaf' ? (
          <NavLink key={entry.id} leaf={entry} selected={active === entry.id} />
        ) : (
          <Collapsible key={entry.id} open={libraryOpen} onOpenChange={setLibraryExpanded}>
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  // `meta`: a Collapsible trigger emits its own `data-slot`, so the
                  // button rule in globals.css misses it and `Library` would sit in
                  // sentence case between two uppercase siblings.
                  className="meta w-full justify-between px-3 font-normal text-muted-foreground"
                />
              }
            >
              {entry.label}
              <ChevronDownIcon
                className={cn('shrink-0 transition-transform', libraryOpen ? '' : '-rotate-90')}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-0.5 pt-0.5 pl-3">
              {entry.children.map((child) => (
                <NavLink key={child.id} leaf={child} selected={active === child.id} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        ),
      )}
    </nav>
  )
}

function NavLink({ leaf, selected }: { leaf: SettingsNavLeaf; selected: boolean }) {
  return (
    <ButtonLink
      href={leaf.href}
      variant="ghost"
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'w-full justify-start px-3 font-normal text-muted-foreground',
        // The blue selected pill in ref 02. Theme tokens, not a hardcoded blue, so the
        // palette stays bodo's while the layout matches.
        selected && 'bg-primary/10 font-medium text-primary hover:bg-primary/15',
      )}
    >
      {leaf.label}
    </ButtonLink>
  )
}
