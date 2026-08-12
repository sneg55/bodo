'use client'

// ⌘K. The trigger in the top bar, the dialog, and the query state behind it.
//
// **This used to be a control that could not answer.** `AdminTopBar` rendered the whole
// dialog off a `searchGroups` prop that defaulted to `[]`, and no call site in `src` ever
// passed it, so `Find or ask` sat at the top of every admin page and always replied
// `No results found.` It was reported as the highest-visibility unfinished thing in the
// product (docs/sessionboard-parity-report.md) and this file is the fix: the state and the
// action live together here, so there is no prop for a caller to forget.
//
// **Two sources, merged, and only one of them costs anything.** `navSearchGroup` is pure
// and derived from the sidebar tree, so the palette lists every built destination the
// instant it opens, with no read and nothing to wait for. Records come from
// `globalSearchAction`, debounced, and only once the query is long enough to mean something.
//
// **The third source is the ask, and it is the only one nobody pays for by accident.**
// `Find or ask` promises both halves. The ask costs a model call, so it never fires off a
// keystroke: it is one row the organizer picks, offered only once the query is long enough
// to be a question rather than a prefix. See `GlobalSearchAnswer.tsx` for what its reply is
// allowed to claim.
//
// **cmdk filters again on the client, and that is load-bearing rather than redundant.**
// `Command` has `shouldFilter` on by default, so an item whose `value` does not match the
// input is dropped no matter what the server returned. Every item's `value` therefore
// carries its group label, its label AND its description, which is what keeps a hit matched
// on a speaker's email from vanishing behind a row that shows their name. The server side
// matches by substring for the same reason: substring implies subsequence, which is what
// cmdk scores.
//
// **The `Go to` group lists only destinations that exist.** Placeholder routes are excluded
// on their HREF rather than on a `placeholder` flag, because a flag can be absent from an
// entry whose href is a placeholder anyway. `Preview` used to be exactly that case and has
// since been removed from the nav; `nav-targets.ts` documents why the href check outlives it.

import { SparklesIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  AskAnswerGroup,
  type AskState,
  PALETTE_GROUP_ENTER,
  ResultItem,
} from '@/components/shell/GlobalSearchAnswer'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { askForQuestion, MAX_ASK_LENGTH, MIN_ASK_LENGTH } from '@/features/ai/ask'
import { bundleSearchGroup } from '@/features/bundle/search-targets'
import { globalSearchAction } from '@/features/search/actions'

import { askEventAction } from '@/features/search/ask-actions'
import {
  MIN_QUERY_LENGTH,
  normalizeQuery,
  searchEmptyMessage,
  searchStatusMessage,
} from '@/features/search/global-search'

import { navSearchGroup } from '@/features/search/nav-targets'
import type { GlobalSearchGroup } from '@/types/search'
import { cn } from '@/utils/cn'

/** Transcribed from the reference top bar, not written here. */
const SEARCH_PLACEHOLDER = 'Find or ask'

/**
 * The stagger between one group's entrance and the next, CAPPED at two steps.
 *
 * The cap is the whole rule. This is a search box before it is a list, so the first group
 * waits for nothing: `Go to` is pure and derived, and delaying it would spend the palette's
 * one advantage buying a flourish. The groups that do wait on a read arrive late anyway, so
 * a step of stagger reads as them landing rather than as lag. Past the second the delay
 * stops growing: a sixth group 500ms behind the first is not a stagger, it is a queue.
 *
 * A ternary rather than an indexed table, because a computed index into an array is what
 * `security/detect-object-injection` fails the build over.
 */
function groupEnterDelay(index: number): string {
  if (index === 0) return ''
  return index === 1 ? 'delay-75' : 'delay-150'
}

/**
 * Long enough that typing a session code does not fire six reads, short enough that the
 * results feel attached to the keystroke. The reads behind the action are cached by tag, so
 * the cost of being wrong in either direction is small.
 */
const DEBOUNCE_MS = 180

/**
 * Results carry the query they answer.
 *
 * Not two separate `groups` and `pending` states, and the reason is a lint rule pointing at
 * a real bug: clearing them from the effect body when the query shrinks below the minimum is
 * a synchronous setState in an effect, which cascades renders. Keyed like this, "stale" and
 * "pending" are both derived by comparing `answered` to the current query, so a response
 * that arrives for a query the organizer has already typed past is simply never displayed.
 */
type SearchResult = {
  readonly answered: string
  readonly groups: readonly GlobalSearchGroup[]
  readonly failure?: string
}

export function GlobalSearch({ eventId }: { eventId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult>()
  const [ask, setAsk] = useState<AskState>()

  // Only 'mousedown' listeners are banned (they mean a hand-rolled popover). A global
  // accelerator has no primitive to defer to: the ⌘K chip in the bar is a promise the page
  // has to keep from anywhere, not just from the search field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (normalizeQuery(query).length < MIN_QUERY_LENGTH) return

    // `cancelled` covers the debounce window; the `answered` key covers the rest. Two
    // requests can resolve in either order, so a late reply to "ku" must not replace the
    // results for "kubernetes", and stamping the query it answers is what makes that
    // decidable at render instead of by luck of arrival.
    let cancelled = false
    const timer = setTimeout(() => {
      void globalSearchAction({ eventId, query }).then((outcome) => {
        if (cancelled) return
        setResult(
          outcome.ok
            ? { answered: query, groups: outcome.groups }
            : { answered: query, groups: [], failure: outcome.message },
        )
      })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, eventId])

  const settled = result?.answered === query ? result : undefined
  // The same rule the line above applies to search results, applied to the answer: it is
  // shown only while it is still the answer to what is typed. Derived rather than cleared
  // in an effect, for the reason `SearchResult` documents.
  const askedNow = askForQuestion(ask, query.trim())
  const pending = normalizeQuery(query).length >= MIN_QUERY_LENGTH && settled === undefined
  // `Export` sits with the nav group rather than with the record results: both are pure,
  // derived and free, so both are answerable the instant the palette opens. Its rows navigate
  // exactly as `Go to`'s do, through the same `ResultItem` and the same `openHref`; what earns
  // it a heading of its own is that these are not sidebar destinations, and filing them under
  // `Go to` would have meant either a second copy of the sidebar or a lie about where they
  // came from. See `features/bundle/search-targets`.
  const allGroups = [
    navSearchGroup(eventId),
    bundleSearchGroup(eventId),
    ...(settled?.groups ?? []),
  ]
  const question = query.trim()

  const openHref = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  // Neither debounced nor cancelled: this fires only when the row is picked, and a reply to
  // a question the organizer has since replaced is dropped on arrival instead.
  const runAsk = () => {
    setAsk({ question })
    void askEventAction({ eventId, question }).then((outcome) => {
      setAsk((current) => (current?.question === question ? { question, outcome } : current))
    })
  }

  // Not named `status`: that is a real global (`window.status`, a string), so an
  // undeclared one type-checks against `=== undefined` as a no-overlap comparison
  // instead of failing. ESLint caught it here; it would have rendered nothing.
  const statusMessage = searchStatusMessage({ pending, failure: settled?.failure })

  return (
    <>
      <Button
        variant="outline"
        className="h-8 w-full max-w-xs justify-start gap-2 px-2.5 font-normal text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        {/* The terminal prompt, straight off the reference, in place of the
            magnifying glass. Same affordance, and it is the mark the whole
            palette is built around. */}
        <span aria-hidden className="font-mono text-primary">
          &gt;_
        </span>
        <span className="truncate">{SEARCH_PLACEHOLDER}</span>
        <Kbd className="ml-auto">⌘K</Kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        {/*
          `maxLength` is the ask's upper bound, not the search's: a paste stops at the field
          rather than after a model call has been paid for. The action checks it again, since
          it is reachable by POST, and search is bounded by the same number for free because
          one field feeds both. Nobody searches with a thousand characters.
        */}
        <CommandInput
          placeholder={SEARCH_PLACEHOLDER}
          value={query}
          onValueChange={setQuery}
          maxLength={MAX_ASK_LENGTH}
        />
        <CommandList>
          {/* Either a status or an empty message, never both, and the status is a plain
              element rather than a `CommandItem` so cmdk neither filters it away nor lets
              the arrow keys land on it. `CommandEmpty` steps aside while a status is
              showing, because "Searching..." above "No results found." is two answers to
              one question. */}
          {/* `text-balance` on both: they are short centred blocks, which is the case a
              single orphaned word looks worst in, and the longest of them is one sentence,
              well inside the six-line ceiling the balancer works within. */}
          {statusMessage === undefined ? (
            <CommandEmpty className="text-balance">{searchEmptyMessage(query)}</CommandEmpty>
          ) : (
            <div role="status" aria-live="polite" className="py-6 text-center text-sm text-balance">
              {statusMessage}
            </div>
          )}

          {question.length < MIN_ASK_LENGTH ? null : (
            <CommandItem value={`Ask ${question}`} onSelect={runAsk}>
              <SparklesIcon />
              <span className="truncate">{`Ask "${question}"`}</span>
            </CommandItem>
          )}

          {askedNow === undefined ? null : <AskAnswerGroup ask={askedNow} onOpen={openHref} />}

          {allGroups.map((group, index) => (
            <CommandGroup
              key={group.id}
              heading={group.label}
              className={cn(PALETTE_GROUP_ENTER, groupEnterDelay(index))}
            >
              {group.items.map((item) => (
                <ResultItem
                  key={item.id}
                  item={item}
                  // Group label, label, description AND keywords: see the header. Dropping
                  // the description here is what makes an email or code hit disappear, and
                  // `keywords` is the same failure one level further in: it carries what the
                  // SERVER matched on but the row does not display, which is how a talk
                  // found by its speaker's name used to vanish on arrival.
                  value={[
                    group.label,
                    item.label,
                    item.description ?? '',
                    item.keywords ?? '',
                  ].join(' ')}
                  onOpen={openHref}
                />
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  )
}
