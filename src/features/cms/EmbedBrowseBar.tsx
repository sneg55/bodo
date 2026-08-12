'use client'

// The visitor's controls on a served embed: search, facets, day navigation. EMB-02/03/07.
//
// One strip rather than three, because they narrow the same list and a visitor reads them
// together. It renders only the controls that can DO something: the day tabs are absent from
// a flat session list, and a facet with one distinct value is a control whose only two states
// show the same rows, so it is not offered either.
//
// Everything here is inventory, not configuration. The facet values come from the sessions
// actually on screen (`embedFacetValues`), never from the event's full track and room lists,
// so a filter can never offer a value that yields nothing.
//
// The count next to Filters is transcribed behaviour: ref 33's Filters section carries an
// applied-filter count badge, and this is the visitor-side counterpart of the organizer's own
// panel. `docs/parity/external-references.md` records it.
//
// NONE OF IT RENDERS UNTIL THE TREE HAS HYDRATED, which is a filed defect and not caution. Every
// control here is client state on a server-rendered page that takes two to six seconds to hydrate,
// and in that window the search box accepts typing React then discards, and the day tabs and the
// Filters popover swallow a click and look unchanged. An eval agent reported exactly that: a tab
// strip whose first click did nothing, with the network showing no request. A skeleton of the same
// height is a control nobody tries to press. `EmbedViewState.tsx` says how the flag works.

import { SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useEmbedViewState } from '@/features/cms/EmbedViewState'
import {
  embedFacetValues,
  embedResultCountLabel,
  isEmbedNarrowed,
  toggleFacetValue,
} from '@/features/cms/embed-browse'

/** A day the visitor can jump to. Taken from the projection, already labelled. */
export type EmbedBrowseDay = { key: string; label: string }

export function EmbedBrowseBar({
  days,
}: {
  /** Empty for the flat session list, which has no day headers to navigate between. */
  days: readonly EmbedBrowseDay[]
}) {
  const state = useEmbedViewState()
  if (state === undefined || state.sessions.length === 0) return null
  if (!state.hydrated) return <BrowseBarSkeleton withDays={days.length > 1} />
  // Off the context rather than off a prop: the provider already holds the list, and passing
  // it again put every abstract on the wire a second time.
  const { sessions } = state

  // Three dimensions, in the order the organizer's own panel lists the ones it shares. FORMAT is
  // here because it was the named gap: Format exists as a filter dimension on the organizer side
  // and as a chip on every card, and the visitor had no way to narrow by it.
  const facets = [
    {
      label: 'Format',
      values: embedFacetValues(sessions, (session) => session.format),
      selected: state.formats,
      set: state.setFormats,
    },
    {
      label: 'Track',
      values: embedFacetValues(sessions, (session) => session.track),
      selected: state.tracks,
      set: state.setTracks,
    },
    {
      label: 'Room',
      values: embedFacetValues(sessions, (session) => session.room),
      selected: state.rooms,
      set: state.setRooms,
    },
    // One distinct value means both states of the control show the same rows.
  ].filter((facet) => facet.values.length > 1)
  const applied = state.tracks.length + state.rooms.length + state.formats.length

  return (
    <div className="flex flex-wrap items-center gap-2 pb-3">
      <div className="relative min-w-48 flex-1">
        <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={state.query}
          onChange={(event) => state.setQuery(event.target.value)}
          placeholder="Search sessions and speakers"
          aria-label="Search sessions and speakers"
          className="pl-8"
        />
        {state.query === '' ? null : (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear search"
            className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2"
            onClick={() => state.setQuery('')}
          >
            <XIcon />
          </Button>
        )}
      </div>

      {facets.length === 0 ? null : (
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" size="sm" className="hit-area-y">
                <SlidersHorizontalIcon data-icon="inline-start" />
                Filters
                {applied === 0 ? null : (
                  <Badge variant="secondary" className="tabular-nums">
                    {applied}
                  </Badge>
                )}
              </Button>
            }
          />
          <PopoverContent align="start" className="w-64">
            <div className="flex flex-col gap-4">
              {facets.map((facet) => (
                <div key={facet.label} className="flex flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {facet.label}
                  </p>
                  {facet.values.map((value) => (
                    <Label key={value} className="flex items-center gap-2 font-normal">
                      <Checkbox
                        checked={facet.selected.includes(value)}
                        onCheckedChange={() => facet.set(toggleFacetValue(facet.selected, value))}
                      />
                      {value}
                    </Label>
                  ))}
                </div>
              ))}
              {applied === 0 ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="hit-area-y"
                  onClick={() => {
                    state.setTracks([])
                    state.setRooms([])
                    state.setFormats([])
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Day navigation, with an explicit All. Only offered where there is more than one day
          to move between, and never on the flat list, which carries its date per row. */}
      {days.length > 1 ? (
        <Tabs
          value={state.day ?? 'all'}
          onValueChange={(next: string) => state.setDay(next === 'all' ? undefined : next)}
        >
          {/* `h-auto min-h-8` is what makes the `flex-wrap` next to it actually work.
              `TabsList` is `h-8` when horizontal, a fixed 32px, so a strip that wrapped
              onto a second row overflowed its own box: on a phone the day tabs printed on
              top of each other and over the `My schedule` and `Add to calendar` buttons
              below, which made several of them unreadable and unclickable. `min-h-8` keeps
              the single-row case exactly 32px as before; `h-auto` lets it grow only when
              it has genuinely wrapped.

              Wrapped rather than scrolled, deliberately. These labels are full dates
              ("Mon, October 12, 2026") and two will not fit on one phone-width line, so a
              horizontal scroller would hide days behind a gesture with no affordance
              saying they are there. Every day stays visible. Fixed at the call site
              because `src/components/ui/**` is generated and must not be styled. */}
          <TabsList variant="line" className="group-data-horizontal/tabs:h-auto min-h-8 flex-wrap">
            <TabsTrigger value="all">All days</TabsTrigger>
            {days.map((day) => (
              <TabsTrigger key={day.key} value={day.key}>
                {day.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
    </div>
  )
}

/**
 * The strip's shape while the tree is still hydrating.
 *
 * The search box is `h-9` (the `Input` default) and the two button-shaped controls are `h-7`, so
 * the rows below do not move when the real controls replace this. Silent to assistive technology:
 * `EmbedScheduleBar` renders directly beneath and carries the one announcement.
 */
function BrowseBarSkeleton({ withDays }: { withDays: boolean }) {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center gap-2 pb-3">
      <Skeleton className="h-9 min-w-48 flex-1" />
      <Skeleton className="h-7 w-24" />
      {withDays ? <Skeleton className="h-8 w-56" /> : null}
    </div>
  )
}

/**
 * How many sessions are on screen, and how many there are in all.
 *
 * WHY IT EXISTS. Two eval agents, on two separate public surfaces, reported that narrowing the
 * list produced no visible change: the rows that left were below the fold, so the search box and
 * the facet panel both read as controls that do nothing. This is the one element that always
 * moves, and it sits between the controls and the list so it is in the same glance as both.
 *
 * `role="status"` because the change it reports is the whole point: a screen reader user typing
 * into the search box gets `3 of 13 sessions` read back rather than silence. The wording and the
 * pluralisation are in `embedResultCountLabel`, which is pure and tested.
 *
 * It states no number until hydration, along with every other claim on these surfaces: before the
 * store has been read the personal surface has narrowed to nothing, and `0 of 13 sessions` would
 * be the same false statement the schedule bar used to make. It still occupies its line, so the
 * list does not jump down when the number arrives.
 */
export function EmbedResultCount() {
  const state = useEmbedViewState()
  if (state === undefined || state.sessions.length === 0) return null
  if (!state.hydrated) return <Skeleton aria-hidden="true" className="mb-3 h-4 w-24" />

  return (
    <p role="status" className="pb-3 text-xs tabular-nums text-muted-foreground">
      {embedResultCountLabel({
        total: state.sessions.length,
        visible: state.visibleIds.size,
        narrowed: isEmbedNarrowed(state),
      })}
    </p>
  )
}
