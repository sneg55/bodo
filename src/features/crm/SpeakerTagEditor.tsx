'use client'

// The Speaker Tags card's editor: apply a tag, remove one, or create one that does not
// exist yet.
//
// It is a `Popover` + `Command` + `Badge`, which is the combination .claude/rules/ui-shadcn.md
// names for "multi-select with removable chips", and `Command` is what the same rule names
// for a searchable picker. The chips ARE the applied set rather than a summary of it, so the
// card reads the same whether or not the picker is open.
//
// It lives here rather than in `src/app/**` because logic belongs in `src/features/<area>`
// and this component owns the apply/remove/create decisions. The profile page composes it.
//
// NO `router.refresh()` after a write, matching every other admin surface here: the Server
// Action expires the tags the Airtable client cached under (`invalidate()`) and its own
// response re-renders this route. `refresh()` would add a round trip and expire nothing,
// which is the trap BUILD_SPEC 6.1 calls out.
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe; `Saved successfully` is the one string the parity docs do give for a write.

import { CheckIcon, PlusIcon, TagIcon, XIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createSpeakerTagAction, setSpeakerTagsAction } from '@/features/crm/actions'
import { checkTagName, nextTagIds } from '@/features/crm/tag-vocabulary'
import type { SpeakerTag } from '@/types/domain'
import { cn } from '@/utils/cn'

export type SpeakerTagEditorProps = {
  speakerId: string
  /** The tags currently on this speaker, already resolved against the vocabulary. */
  tags: readonly SpeakerTag[]
  /** Every tag in the base. Global, not event-scoped: the table has no event link. */
  vocabulary: readonly SpeakerTag[]
}

export function SpeakerTagEditor({ speakerId, tags, vocabulary }: SpeakerTagEditorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pending, startTransition] = useTransition()

  const applied = new Set(tags.map((tag) => tag.id))

  // `startTransition(async () => ...)`, and here the shape is CORRECTNESS rather than
  // polish. The synchronous-scope form (`startTransition(() => { void (async () => …)() })`)
  // returns before scheduling anything, so `isPending` is false again in the same tick and
  // every `disabled={pending}` below does nothing. That is a double-submit hole anywhere; in
  // THIS component it loses writes, because `toggle` derives the next set from the `tags`
  // prop and `setSpeakerTags` REPLACES membership rather than diffing it
  // (mutations-crm.ts). Two clicks before the first round trip re-renders both compute from
  // the same stale prop, so the second silently discards the first. The async form keeps the
  // controls disabled until the transition settles, which is what serialises them.
  const run = (work: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
    startTransition(async () => {
      const result = await work()
      if (result.ok) {
        toast.success(success)
        return
      }
      toast.error(result.message ?? 'That did not save.')
    })
  }

  /** The whole set, never a delta: `setSpeakerTags` replaces membership. */
  const write = (tagIds: readonly string[], success: string) => {
    run(async () => await setSpeakerTagsAction({ speakerId, tagIds }), success)
  }

  const toggle = (tagId: string) => {
    // `nextTagIds` is the same rule, pulled into `tag-vocabulary.ts` so the reason these
    // writes must not overlap is asserted rather than described. It reads the `tags` PROP,
    // which is exactly why `pending` has to hold: see `run` above.
    write(nextTagIds(tags, tagId), applied.has(tagId) ? 'Tag removed' : 'Saved successfully')
  }

  // Offered only when the typed name is usable: a "Create" row for a name that already
  // exists would put two rows meaning the same thing in front of the organizer, and the
  // action would refuse it anyway.
  const creatable = query.trim().length > 0 && checkTagName(query, vocabulary).ok

  const create = () => {
    setQuery('')
    // Same async form, same reason. This path is two round trips deep, so the window in
    // which the old shape left the controls live was twice as wide.
    startTransition(async () => {
      const created = await createSpeakerTagAction({ name: query })
      if (!created.ok) {
        toast.error(created.message)
        return
      }
      // Applied in the same gesture. Creating a tag from a person's card and then having
      // to pick it is the card asking twice for one intention.
      const applyResult = await setSpeakerTagsAction({
        speakerId,
        tagIds: [...applied, created.tag.id],
      })
      if (!applyResult.ok) {
        toast.error(applyResult.message)
        return
      }
      toast.success('Saved successfully')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {tags.length === 0 ? (
        // Authored, and it says what a tag is FOR rather than only that there are none:
        // this is the first place an organizer meets the vocabulary.
        <p className="text-sm text-muted-foreground">
          No tags yet. Tags label a person across every event.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            // `overflow-visible` is the enabler for the remove button's hit area, not a look:
            // `Badge` sets `overflow-hidden`, which clips a descendant's pseudo-element to the
            // 20px chip, so the `hit-area-[26px]` below would have been clipped back to 18px
            // and bought nothing. Nothing in a `w-fit` chip overflows, so the clip was inert.
            <Badge key={tag.id} variant="outline" className="gap-1.5 overflow-visible pr-1">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              {tag.name}
              <Button
                variant="ghost"
                size="icon"
                disabled={pending}
                // 16px is far too small to press. 26px is the ceiling: the chips wrap at
                // `gap-1.5`, so a remove button in the next row sits 20px (chip height) + 6px
                // (gap) = 26px below this one, and two 26px areas 26px apart meet without
                // crossing. Horizontally the next chip's own remove button is a whole chip
                // away, so the 5px of growth past this chip's `pr-1` lands on nothing.
                className="size-4 rounded-full hit-area-[26px]"
                aria-label={`Remove ${tag.name}`}
                onClick={() => toggle(tag.id)}
              >
                <XIcon className="size-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            // `hit-area-y` and not `hit-area`: the button is already wide enough and only
            // 28px tall. It grows 6px each way, and the chip row above is `gap-3` (12px) off,
            // where the chips' own 26px areas reach down 5px: 5 + 6 = 11 <= 12.
            <Button
              variant="outline"
              size="sm"
              className="self-start hit-area-y"
              disabled={pending}
            >
              <TagIcon data-icon="inline-start" />
              Edit tags
            </Button>
          }
        />
        <PopoverContent align="start" className="w-64 p-0">
          <Command>
            <CommandInput placeholder="Search tags..." value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>No tags found.</CommandEmpty>
              {/* Every row is disabled while a write is in flight, and that is the point of
                  getting `pending` to work at all: the popover stays OPEN across a toggle,
                  so two rows clicked in a row are the exact case that loses a write. The
                  trigger being disabled does not help once the popover is open. */}
              <CommandGroup>
                {vocabulary.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    disabled={pending}
                    onSelect={() => toggle(tag.id)}
                  >
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="min-w-0 truncate">{tag.name}</span>
                    <CheckIcon
                      className={cn('ml-auto size-4', applied.has(tag.id) ? '' : 'opacity-0')}
                    />
                  </CommandItem>
                ))}
                {creatable ? (
                  <CommandItem value={`create ${query}`} disabled={pending} onSelect={create}>
                    <PlusIcon className="size-4" />
                    <span className="min-w-0 truncate">{`Create "${query.trim()}"`}</span>
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
