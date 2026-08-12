'use client'

// The sidebar's event chip, and the modal it opens.
//
// **It used to be a link to `/admin/events`**, a whole page for choosing an event. Switching
// context is not a destination: you are somewhere, you want to be somewhere else, and being
// taken to a third place to ask for it loses the page you were on for no benefit. A modal
// answers in place and closes.
//
// **The list is loaded when the modal opens, never before.** The sidebar renders on every
// admin page, so reading one event record per membership to fill this would put that cost,
// and that much serialized payload, on every page load to populate a dialog most visits
// never open. Same reasoning and same shape as the ⌘K palette
// (`src/features/search/actions.ts`), including the failure being visible rather than
// indistinguishable from an empty list.
//
// The chip's own markup stays exactly as it was, avatar, truncating name, gold date line and
// chevron, because that part IS transcribed (docs/parity/event-config.md ref 19 and the
// same row in four other parity docs). Only what it does changed.

import { ChevronsUpDownIcon } from 'lucide-react'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { ButtonLink } from '@/components/primitives/ButtonLink'
import { MetaLabel } from '@/components/primitives/MetaLabel'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { listEventChoicesAction } from '@/features/events/actions'
import type { EventChoice } from '@/features/events/choices'
import { cn } from '@/utils/cn'

export type EventSwitcherEvent = {
  id: string
  name: string
  initials: string
  dateRange: string
  avatarUrl?: string
}

/** What the modal is showing: nothing yet, a list, or why there is no list. */
type Loaded = {
  readonly choices: readonly EventChoice[]
  readonly failure?: string
}

export function EventSwitcher({
  event,
  collapsed,
}: {
  event: EventSwitcherEvent
  collapsed: boolean
}) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState<Loaded>()
  const [pending, startTransition] = useTransition()

  function onOpenChange(next: boolean): void {
    setOpen(next)
    // Re-read on every open rather than caching in component state. An organizer who just
    // created an event and reopened this would otherwise be shown the list from before it
    // existed, and the reads behind the action are tagged, so a repeat open is cheap.
    if (!next) return
    startTransition(async () => {
      const result = await listEventChoicesAction()
      setLoaded(result.ok ? { choices: result.choices } : { choices: [], failure: result.message })
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            // No `nativeButton={false}` here, and that is the whole point: the prop tells
            // Base UI which element the `render` prop will actually produce, and this
            // Button has no `render` of its own, so it produces a real `<button>`. Claiming
            // otherwise made it apply `role="button"` on top of the trigger's
            // `type="button"` and logged an error on every admin page.
            className={cn(
              // `plain-label`: the event name is the organiser's own text, and the
              // mono-uppercase button treatment is for machine labels only.
              'plain-label mx-2 h-auto justify-start gap-2 border border-border py-1.5',
              collapsed && 'mx-1 justify-center border-transparent',
            )}
          />
        }
      >
        <Avatar size="sm">
          {event.avatarUrl === undefined ? null : (
            <AvatarImage src={event.avatarUrl} alt={event.name} />
          )}
          <AvatarFallback>{event.initials}</AvatarFallback>
        </Avatar>
        {collapsed ? (
          <span className="sr-only">{event.name}</span>
        ) : (
          <>
            <span className="flex min-w-0 flex-col items-start">
              <span className="w-full truncate text-sm font-medium">{event.name}</span>
              {/* Gold, mono, uppercase: the reference gives every date this
                  treatment, and it is the one line of the sidebar an organiser
                  reads to confirm they are in the right event. */}
              <MetaLabel tone="accent">{event.dateRange}</MetaLabel>
            </span>
            {/* Optical padding on the trailing side only. It is inside the expanded branch,
                so the collapsed chip (avatar alone, centred) carries no attribute and keeps
                its symmetric padding. */}
            <ChevronsUpDownIcon
              data-icon="inline-end"
              className="ml-auto shrink-0 text-muted-foreground"
            />
          </>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch event</DialogTitle>
          <DialogDescription>Every event your account is a member of.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          <SwitcherBody current={event.id} loaded={loaded} pending={pending} />
        </div>

        {/* `nativeButton={false}`, unlike the trigger above: this one DOES carry a
            `render`, and a `Link` is an `<a>`. Without it Base UI puts `type="button"` on
            an anchor and reports the mismatch. Same pairing as `EventRow` below. */}
        <ButtonLink href="/admin/new" variant="outline">
          Create Event
        </ButtonLink>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The list, or the one true sentence about why there is no list.
 *
 * Four states told apart, for the reason the palette's `emptyMessage` documents: saying
 * "no events" while a read is in flight, or when it failed, is the same lie as reporting an
 * empty search before searching.
 */
function SwitcherBody({
  current,
  loaded,
  pending,
}: {
  current: string
  loaded: Loaded | undefined
  pending: boolean
}) {
  if (pending || loaded === undefined) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Loading events...</p>
  }
  if (loaded.failure !== undefined) {
    return <p className="py-4 text-center text-sm text-destructive">{loaded.failure}</p>
  }
  if (loaded.choices.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        You are not a member of any event yet.
      </p>
    )
  }
  return (
    <>
      {loaded.choices.map((choice) => (
        <EventRow key={choice.id} choice={choice} current={current} />
      ))}
    </>
  )
}

function EventRow({ choice, current }: { choice: EventChoice; current: string }) {
  return (
    <ButtonLink
      href={`/admin/${choice.navRef}`}
      variant="ghost"
      // `aria-current` and not only the ring: which event you are already in is the first
      // thing this dialog has to answer, and a colour is not an answer to a screen reader.
      aria-current={choice.id === current ? 'true' : undefined}
      className={cn(
        'plain-label h-auto w-full justify-start gap-3 px-3 py-2',
        choice.id === current && 'bg-accent',
      )}
    >
      <Avatar size="sm">
        {choice.avatarUrl === undefined ? null : (
          <AvatarImage src={choice.avatarUrl} alt={choice.name} />
        )}
        <AvatarFallback>{choice.initials}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col items-start">
        <span className="w-full truncate text-sm font-medium">{choice.name}</span>
        <MetaLabel tone="accent">{choice.dateRange}</MetaLabel>
      </span>
      <Badge variant="outline" className="ml-auto shrink-0">
        {choice.role}
      </Badge>
    </ButtonLink>
  )
}
