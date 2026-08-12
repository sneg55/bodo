'use client'

// Search by name over the two roster views. R9, EMB-12.
//
// The Speaker Gallery had no input at all, so narrowing a grid of headshots to the one person a
// visitor came for was impossible. `EmbedBrowseBar` could not supply it: that bar is built out of
// the sessions on screen and both roster views project none, so it renders nothing there and
// correctly so, since a gallery is not something anybody filters by room.
//
// So the roster gets its own control, and it REUSES the visitor state and the matcher the session
// search already owns rather than adding a second notion of "what has been typed":
// `state.query` is the one field, `matchesSpeakerQuery` wraps the same folded multi-term matcher
// (@/features/cms/embed-browse), and only one of the two bars can ever be on screen at a time.
//
// `matchesSpeakerQuery` LIVES HERE, and that is placement rather than convenience. It used to sit
// in @/features/cms/speakers beside the projection, and that file now sanitizes the biography, so
// a value import of it from this client module would pull `htmlparser2` into the embed's chunk for
// the sake of one string comparison. The only thing this island takes from there is a TYPE, which
// is erased at build time.
//
// Two islands rather than a client roster, for the reason the whole embed is built this way: the
// cards stay server components and only the input and a two-line wrapper per card ship to the
// browser. Both render as if absent when there is no provider, which is what the editor's preview
// panel gets.

import { SearchIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useEmbedViewState } from '@/features/cms/EmbedViewState'
import { embedResultCountLabel, matchesEmbedQuery } from '@/features/cms/embed-browse'
import type { EmbedSpeaker } from '@/features/cms/speakers'

/** Only the fields the matcher reads, so a bio is not shipped to the browser to be searched. */
export type SearchableSpeaker = Pick<EmbedSpeaker, 'id' | 'name' | 'tagline' | 'company'>

export function EmbedSpeakerSearch({ speakers }: { speakers: readonly SearchableSpeaker[] }) {
  const state = useEmbedViewState()
  if (state === undefined || speakers.length === 0) return null

  // NOTHING RENDERS UNTIL THE TREE HAS HYDRATED, which is the rule `EmbedBrowseBar` and
  // `EmbedScheduleBar` already follow and the reason is the same filed defect. This page is
  // server markup that hydrates two to six seconds later, and for that whole window the input
  // is on screen and looks ready: a visitor who types into it is typing into a control whose
  // `value` is state that does not exist yet, so hydration resets the box and their query is
  // gone. A skeleton of the same height is a control nobody tries to use, and the grid below
  // does not move when the real one arrives.
  if (!state.hydrated) return <SpeakerSearchSkeleton />

  const matched = speakers.filter((speaker) => matchesSpeakerQuery(speaker, state.query)).length

  return (
    <div className="flex flex-col gap-2 pb-3">
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={state.query}
          onChange={(event) => state.setQuery(event.target.value)}
          placeholder="Search speakers"
          aria-label="Search speakers"
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
      {/* The count is the element that always moves when the query changes, which is the whole
          point of it: two eval agents reported that narrowing a public list showed no visible
          feedback because the rows that left were off-screen. Same wording as the session
          surfaces, with its own noun, rather than a second copy of the sentence. */}
      <p role="status" className="text-xs tabular-nums text-muted-foreground">
        {embedResultCountLabel({
          total: speakers.length,
          visible: matched,
          narrowed: state.query.trim() !== '',
          noun: { one: 'speaker', many: 'speakers' },
        })}
      </p>
      {/* An empty grid under a search box reads as a broken widget rather than as a query that
          matched nobody, which is the one state a search has to be able to state out loud. */}
      {state.query !== '' && matched === 0 ? (
        <p className="text-sm text-muted-foreground">No speakers match your search.</p>
      ) : null}
    </div>
  )
}

/**
 * The control's shape while the tree is still hydrating.
 *
 * `h-9` is the `Input` default, so the roster does not jump when the real control replaces this.
 * Silent to assistive technology: it states nothing, and there is nothing here worth announcing.
 */
function SpeakerSearchSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 pb-3">
      <Skeleton className="h-9 w-full" />
    </div>
  )
}

/** One card's slot in the roster, hidden when the visitor has searched it away. */
export function EmbedSpeakerItem({
  speaker,
  children,
}: {
  speaker: SearchableSpeaker
  children: React.ReactNode
}) {
  const state = useEmbedViewState()
  if (state === undefined) return children
  return matchesSpeakerQuery(speaker, state.query) ? children : null
}

/**
 * Whether a speaker survives the roster's name search.
 *
 * The same folded multi-term matcher the session search uses, handed the speaker's own fields:
 * every term must match, case and accents folded, so "okafor" and "Ada Okafor" both find her and
 * a roster of international speakers does not lose "José" to somebody typing "jose". The job
 * title and the company are searchable too, because "latticework" is a thing a visitor plausibly
 * remembers about a person whose surname they do not.
 *
 * It takes a `SearchableSpeaker` and not a whole `EmbedSpeaker`, which is what the four fields
 * shipped to the browser already are. The biography is deliberately not among them: it is not
 * something anybody searches a roster by, and it is the largest string on the record.
 */
export function matchesSpeakerQuery(speaker: SearchableSpeaker, query: string): boolean {
  return matchesEmbedQuery(
    {
      title: speaker.name,
      speakers: [speaker.tagline ?? '', speaker.company ?? ''],
    },
    query,
  )
}
