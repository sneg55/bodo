'use client'

// Ref 26's Portals > Forms list: the `+ Add` button, the four type tabs with counts, the empty
// state, and the cards.
//
// Search, tab and assign-in-flight are local state. There is no server-side filtering to drive:
// an event's portal form list is a handful of rows and the whole set is already in this page's
// payload, so a URL query string would cost a round trip to filter what the browser holds. The
// sibling boards make the same call for the same reason.
//
// The search input is an ADDITION. Ref 26 captured this list empty and its inventory names only
// the header, `+ Add`, the tabs and the empty state, while ref 25's sibling carries
// `Search tasks...`. Borrowed rather than invented, and it filters for real.
//
// Assigning is per form rather than a bulk action, and that is the one place this board
// deliberately differs from its siblings: each portal form is assigned through its OWN form-kind
// task (see `planFormTask`), so there is no single fan-out that could take a selection. The
// checkbox column the other two carry would therefore have nothing to do.

import { ChevronDownIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { assignPortalFormAction } from '@/features/portal-forms/assign-action'
import {
  filterPortalFormCards,
  type PortalFormTab,
  portalFormTabs,
} from '@/features/portal-forms/cards'
import type { PortalFormsListView } from '@/features/portal-forms/reads'

import { PortalFormCard } from './PortalFormCard'

export function PortalFormsBoard({
  eventId,
  view,
  canEdit,
}: {
  eventId: string
  view: PortalFormsListView
  /** A reviewer can read this surface. Every write requires `admin` regardless. */
  canEdit: boolean
}) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<PortalFormTab>('all')
  const [pending, startTransition] = useTransition()

  const base = `/admin/${eventId}/portal-forms`
  const visible = filterPortalFormCards(view.cards, tab, search)

  const assign = (formId: string) => {
    startTransition(async () => {
      const result = await assignPortalFormAction({ eventId, formId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(
        result.created === 0
          ? 'Already assigned'
          : `Assigned to ${result.created} ${result.created === 1 ? 'person' : 'people'} across ${result.speakers} accepted ${result.speakers === 1 ? 'speaker' : 'speakers'}`,
        {
          description:
            result.skipped === 0
              ? undefined
              : `${result.skipped} already had a row and were left alone.`,
        },
      )
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={search}
          placeholder="Search forms..."
          className="max-w-sm"
          onChange={(event) => setSearch(event.target.value)}
        />
        {/* Ref 26 draws a closed `+ Add` with a chevron and captures no menu behind it, so this
            is a button and not a split dropdown: inventing a menu with one real item would be
            adding a control the reference does not show. The chevron is kept because ref 26
            draws one, and it is decorative here. Same call `AddFileRequestButton` made. */}
        <ButtonLink href={`${base}/new`} disabled={!canEdit}>
          <PlusIcon />
          Add
          <ChevronDownIcon aria-hidden />
        </ButtonLink>
      </div>

      <Tabs value={tab} onValueChange={(next: string) => setTab(next as PortalFormTab)}>
        <TabsList variant="line" className="group-data-horizontal/tabs:h-auto min-h-8 flex-wrap">
          {portalFormTabs(view.cards).map((entry) => (
            <TabsTrigger key={entry.id} value={entry.id}>
              {entry.label}
              <Badge variant="secondary">{entry.count}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          {/* Verbatim off ref 26's empty state. */}
          <p className="font-medium">No forms yet</p>
          <p className="text-sm text-muted-foreground">
            Create a form to collect information from participants
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((card) => (
            <PortalFormCard
              key={card.id}
              card={card}
              editHref={`${base}/${card.id}`}
              disabled={!canEdit || pending}
              onAssign={() => assign(card.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
