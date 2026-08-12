'use client'

// The dynamic speaker list control: pick a list, save the current filters as one, keep it
// up to date, rename it, delete it.
//
// It sits in the DataTable's `toolbarViews` slot, which is the slot Saved Views occupies on
// Abstracts and the Agenda List. That is deliberate rather than convenient: the reference
// puts one stored-query control immediately after the row-density button and before Columns
// / Sort / Filter, and a speaker list IS this surface's stored query. Task 7 declined to
// build a separate toolbar tag dropdown on the grounds that in the reference that control
// and this one are the same thing; this is the one control, and a tag filter is reached
// through Filter like every other field.
//
// Applying a list is a NAVIGATION, not local state: the filters go into the address bar
// through the same codec the Filter pane writes through (`directory-query.ts`), so the
// server re-runs the query, a filtered directory stays a link an organizer can send, and
// there is no second copy of the filter state to keep in step.
//
// COPY IS AUTHORED. The parity report waives the whole CRM area (it appears in no
// screenshot), so nothing here is transcribed; the shapes are lifted from `SavedViewsControl`
// so the two behave alike, and `Saved successfully` is the toast the parity docs do give.

import { ChevronDownIcon, ListFilterIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { DataTableFilter } from '@/components/primitives/data-table-types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  deleteSpeakerListAction,
  type SaveSpeakerListInput,
  saveSpeakerListAction,
} from '@/features/crm/actions'
import { DeleteEmptyListDialog } from '@/features/crm/DeleteEmptyListDialog'
import {
  applySpeakerList,
  checkListFilters,
  hasFilters,
  ownedList,
  showingList,
  sortSpeakerLists,
  usableLists,
} from '@/features/crm/lists'
import { SaveSpeakerListDialog } from '@/features/crm/SaveSpeakerListDialog'
import type { SpeakerList } from '@/types/domain'

/** The radio value for "no list applied", which is the directory's own unfiltered state. */
const NO_LIST = 'none'

export type SpeakerListPickerProps = {
  lists: readonly SpeakerList[]
  /** The viewer, so the menu can tell a list they may edit from one they may only read. */
  userId: string
  /** What the table is filtered by right now: what a save captures, and what Update stores. */
  filters: readonly DataTableFilter[]
  onApply: (filters: readonly DataTableFilter[]) => void
}

export function SpeakerListPicker({ lists, userId, filters, onApply }: SpeakerListPickerProps) {
  const [dialog, setDialog] = useState<'new' | 'rename' | null>(null)
  const [removing, setRemoving] = useState<SpeakerList | null>(null)
  const [pending, startTransition] = useTransition()

  // THREE SETS, and the split is the point.
  //
  // `ordered` is every list the viewer may SEE. It is what the name check runs against,
  // because the Server Action checks names against the same set: filtering it here to the
  // applicable ones let an invisible list keep reserving its name, so Save looked fine and
  // the action refused with "A list called that already exists." naming a list the organizer
  // could not find anywhere.
  //
  // `applicable` is what the radio group offers, because a list storing no filters can never
  // be applied and picking it would do nothing.
  //
  // `broken` is the difference, narrowed to the ones this viewer owns. Those rows are
  // REACHABLE: the build before the empty-set rule created them straight from
  // `Save current filters...` on an unfiltered table, so any base that build wrote against
  // can hold them. Hiding them everywhere made them undeletable through the app, which is
  // not the safe end of that trade. Deleting needs no filters, so they are listed for
  // exactly that.
  const ordered = sortSpeakerLists(lists)
  const applicable = usableLists(ordered)
  const broken = ordered.filter(
    (list) => !hasFilters(list) && ownedList(ordered, list.id, userId) !== undefined,
  )

  // Which list the table is showing, matched on the filters rather than remembered: the
  // query lives in the URL, so a reload, a shared link and the Back button all resolve the
  // same way, and there is no id to go stale against a list somebody else just deleted.
  const applied = applicable.find((list) => showingList(list, filters))
  const editable = applied === undefined ? undefined : ownedList(ordered, applied.id, userId)
  // Whether the current query is worth saving at all, checked here so the menu item is
  // disabled rather than opening a dialog whose Save button can only be refused.
  const saveable = checkListFilters(filters).ok

  // `startTransition(async () => ...)` and NOT `startTransition(() => { void (async () => …)() })`.
  // The second shape returns synchronously without scheduling a transition update, so
  // `pending` is false again in the same tick and every `disabled={pending}` below is
  // decorative: the menu stays live through the round trip and a second click submits again.
  // Enforced now, rather than remembered: see `REACT_CORRECTNESS_RESTRICTED_SYNTAX` in
  // eslint.restricted-syntax.mjs.
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

  const save = (input: SaveSpeakerListInput, success: string) => {
    setDialog(null)
    run(async () => await saveSpeakerListAction(input), success)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" disabled={pending} />}>
          <ListFilterIcon data-icon="inline-start" />
          Lists
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuRadioGroup
            value={applied?.id ?? NO_LIST}
            onValueChange={(next: string) => {
              // `applicable`, matching what the group renders: only a list that stores
              // filters can be applied, and resolving against the wider set would let an
              // empty one resolve to the unfiltered table under a list's name.
              const picked = applicable.find((list) => list.id === next)
              onApply(picked === undefined ? [] : applySpeakerList(picked))
            }}
          >
            <DropdownMenuLabel>Lists</DropdownMenuLabel>
            <DropdownMenuRadioItem value={NO_LIST}>All speakers</DropdownMenuRadioItem>
            {applicable.map((list) => (
              <DropdownMenuRadioItem key={list.id} value={list.id}>
                <span className="min-w-0 truncate">{list.name}</span>
                {list.isShared ? (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">Shared</span>
                ) : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {/* Disabled on an unfiltered table: a list is a filter set, and one storing
                none of them would match the plain directory and capture it. */}
            <DropdownMenuItem disabled={pending || !saveable} onClick={() => setDialog('new')}>
              Save current filters...
            </DropdownMenuItem>
            {/* The three below act on the APPLIED list and are disabled unless the viewer
                owns it. A shared list is readable by everyone and writable by its owner
                only, which the action enforces for itself; disabling them here is so the
                menu does not offer a click that can only fail. */}
            {/* `saveable` again: overwriting a list with the empty set would leave a stored
                row that can never be applied, which is the same state the save path refuses
                to create. Unreachable in practice, since an applied list means the table has
                its filters, but the rule should not depend on that. */}
            <DropdownMenuItem
              disabled={pending || editable === undefined || !saveable}
              onClick={() => {
                if (editable === undefined) return
                save(
                  {
                    id: editable.id,
                    name: editable.name,
                    isShared: editable.isShared,
                    filters,
                  },
                  'Saved successfully',
                )
              }}
            >
              Update with current filters
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={pending || editable === undefined}
              onClick={() => setDialog('rename')}
            >
              Rename list...
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={pending || editable === undefined}
              onClick={() => {
                if (editable === undefined) return
                // The filters go first: leaving the table filtered by a list the menu no
                // longer offers would look like the delete failed.
                onApply([])
                run(
                  async () => await deleteSpeakerListAction({ listId: editable.id }),
                  'List deleted',
                )
              }}
            >
              Delete list
            </DropdownMenuItem>
          </DropdownMenuGroup>

          {/* Rows that store no filters, so they can never be applied and none of the four
              controls above can reach them. Listed only for their owner, and only to be
              removed. The label sits INSIDE the group: `DropdownMenuLabel` is Base UI's
              `Menu.GroupLabel` and throws with no group ancestor. */}
          {broken.length === 0 ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Empty lists</DropdownMenuLabel>
                {broken.map((list) => (
                  <DropdownMenuItem
                    key={list.id}
                    disabled={pending}
                    onClick={() => setRemoving(list)}
                  >
                    <span className="min-w-0 truncate">{list.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">Remove</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outside `DropdownMenuContent`: inside, it would unmount with the menu the instant
          the row that opened it was clicked. */}
      <DeleteEmptyListDialog
        list={removing}
        pending={pending}
        onCancel={() => setRemoving(null)}
        onConfirm={(listId) => {
          setRemoving(null)
          run(async () => await deleteSpeakerListAction({ listId }), 'List deleted')
        }}
      />

      {dialog === null ? null : (
        <SaveSpeakerListDialog
          onClose={() => setDialog(null)}
          existing={ordered}
          editing={dialog === 'rename' ? editable : undefined}
          filterCount={filters.length}
          pending={pending}
          onSave={(input) => {
            if (dialog === 'rename') {
              if (editable === undefined) return
              // Renaming stores what the list ALREADY matches, not what the table shows:
              // the two are the same set right now, but reading them off the stored row
              // means a rename cannot quietly become an overwrite.
              save(
                {
                  id: editable.id,
                  name: input.name,
                  isShared: input.isShared,
                  filters: applySpeakerList(editable),
                },
                'Saved successfully',
              )
              return
            }
            save({ name: input.name, isShared: input.isShared, filters }, 'Saved successfully')
          }}
        />
      )}
    </>
  )
}
