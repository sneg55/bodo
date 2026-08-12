'use client'

// The `Answer` half of ⌘K: the ask's reply, the disclosures that go with it, and the row
// shape both halves of the palette share.
//
// Split out of `GlobalSearch.tsx` rather than living next to the query state because it is
// a different concern (what an answer is allowed to claim) and because that file is at its
// size limit. It owns no state: `GlobalSearch` runs the action and hands the result down.
//
// **Every row here was resolved server-side against the event's own records.** Nothing in
// this file turns model output into a link. `resolveRefs` in `src/features/ai/ask.ts`
// already dropped every citation it could not account for, so an id the model invented
// arrives as an answer with one fewer row under it, never as a link into nothing.
//
// **The answer says what it is not.** A sample answer that reads as live, and a partial
// answer that reads as complete, are the two ways this surface could mislead an organizer.
// Both are decided server-side and passed down, so neither is inferred here.

import { CommandGroup, CommandItem } from '@/components/ui/command'
import type { AskOutcome } from '@/features/ai/ask'
import type { ActionResult } from '@/features/review/action-result'
import type { GlobalSearchItem } from '@/types/search'

/**
 * Keyed on the question, for the same reason the search result is keyed on its query: the
 * organizer can keep typing while an answer is in flight, and a reply must land on the
 * question it was asked about or not at all. `outcome` absent means still thinking.
 */
export type AskState = {
  readonly question: string
  readonly outcome?: ActionResult<AskOutcome>
}

/**
 * How a group of palette rows arrives: split per group and staggered, rather than the
 * whole list appearing at once.
 *
 * It lives here rather than in `GlobalSearch.tsx` because that file already imports this
 * one, and the reverse would be a cycle. Both halves of the palette use it, which is the
 * point: a `Go to` group and an `Answer` group have to arrive the same way.
 *
 * `fill-mode-backwards` is not optional next to a delay. Without it a delayed group paints
 * at full opacity first and only then snaps back to the animation's starting frame, which
 * is a flash rather than a stagger. `backwards` rather than `both`, because only the delay
 * window needs covering: the `enter` keyframe has no `to` block, so holding it forwards
 * would pin the group to a state it already has.
 *
 * `cmdk` keeps a `Command.Group` mounted and toggles `hidden` on it as the filter changes,
 * so this runs when a group genuinely arrives, not on every keystroke.
 */
export const PALETTE_GROUP_ENTER =
  'animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-backwards duration-200 ease-[cubic-bezier(0.2,0,0,1)]'

/**
 * One row shape for a search hit and for a record an answer cites, so the two cannot drift
 * apart visually while pointing at the same record.
 *
 * `value` is passed in rather than derived because the two callers need different text in
 * it: cmdk filters every item against the input, so a search row carries its group label
 * and an answer row carries the question it belongs to.
 */
export function ResultItem({
  item,
  value,
  onOpen,
}: {
  item: GlobalSearchItem
  value: string
  onOpen: (href: string) => void
}) {
  return (
    // `tabular-nums` on the row rather than on one span, because both halves of it count
    // for something: an overflow row's label carries a live total that changes with every
    // keystroke (`See all 60 matching submissions`), and a submission's description is its
    // code, which the Abstracts list already sets in tabular figures. Proportional digits
    // reflow the label under the organizer as they type.
    <CommandItem value={value} className="tabular-nums" onSelect={() => onOpen(item.href)}>
      <span className="truncate">{item.label}</span>
      {item.description === undefined ? null : (
        <span className="ml-auto truncate text-xs text-muted-foreground">{item.description}</span>
      )}
    </CommandItem>
  )
}

export function AskAnswerGroup({ ask, onOpen }: { ask: AskState; onOpen: (href: string) => void }) {
  return (
    <CommandGroup heading="Answer" className={PALETTE_GROUP_ENTER}>
      <CommandItem
        // The question, so cmdk's own filter keeps this block visible: an answer worded
        // without the words that were typed would otherwise vanish the instant it arrived.
        // `disabled` takes it out of keyboard navigation, which is what makes the rows
        // under it the first thing the arrow keys reach, and the opacity override undoes
        // the dimming that comes with it, because this is the content and not a
        // greyed-out control.
        value={`${ask.question} answer`}
        disabled
        className="flex-col items-start gap-1 whitespace-normal data-[disabled=true]:opacity-100"
      >
        {/* `text-pretty` on both: this is the one place in the palette that wraps
            (`whitespace-normal` above), and a model's answer and the partial-answer
            notice are exactly the short prose that strands a single word on its own
            line otherwise. */}
        <span className="text-sm text-pretty">{answerText(ask)}</span>
        {noticesFor(ask).map((notice) => (
          <span key={notice} className="text-xs text-pretty text-muted-foreground">
            {notice}
          </span>
        ))}
      </CommandItem>
      {itemsOf(ask).map((item) => (
        <ResultItem
          key={item.id}
          item={item}
          value={[ask.question, item.label, item.description ?? ''].join(' ')}
          onOpen={onOpen}
        />
      ))}
    </CommandGroup>
  )
}

function itemsOf(ask: AskState): readonly GlobalSearchItem[] {
  return ask.outcome?.ok === true ? ask.outcome.items : []
}

/**
 * Three states and none of them is silence. A failed ask shows what failed, because an
 * empty Answer group would read as the model having had nothing to say.
 */
function answerText(ask: AskState): string {
  if (ask.outcome === undefined) return 'Thinking...'
  return ask.outcome.ok ? ask.outcome.answer : ask.outcome.message
}

/**
 * What the answer is NOT, said next to it.
 *
 * Both facts are decided server-side and passed down, including the sample wording itself:
 * importing `AI_SAMPLE_NOTICE` here would pull `@anthropic-ai/sdk` into this bundle. See
 * `AskOutcome.mockNotice`.
 */
function noticesFor(ask: AskState): readonly string[] {
  if (ask.outcome === undefined || !ask.outcome.ok) return []
  const truncated = ask.outcome.truncated
  return [
    ...(ask.outcome.mocked ? [ask.outcome.mockNotice] : []),
    ...(truncated.length === 0
      ? []
      : [
          `Partial answer: ${truncated.join(' and ')} were capped in what the model was shown, so records past the cap were not considered.`,
        ]),
  ]
}
