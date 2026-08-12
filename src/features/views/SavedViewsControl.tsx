'use client'

// The Saved Views dropdown, shared by Abstracts and the Agenda List.
//
// The BUTTON is transcribed: ref 19 puts an eye icon, the label "Saved Views" and a
// chevron immediately after the row-density control, and that is what renders. Everything
// INSIDE the menu is AUTHORED. The reference never opened it
// (docs/parity/abstracts-review.md, Ambiguities: "Saved Views dropdown contents and view
// creation flow"), so the internals are kept to the four things the persistence supports
// and nothing more: pick a view, save the current one, make the picked one the default,
// delete it.
//
// Picking is a `DropdownMenuRadioGroup`, because picking a view is exactly a single choice
// and the radio item is what draws the mark on the current one. Its label sits INSIDE the
// group: `DropdownMenuLabel` is Base UI's `Menu.GroupLabel` and throws
// `MenuGroupContext is missing` with no Group or RadioGroup ancestor, which is how it
// crashed the density menu on every table in the app.

import { ChevronDownIcon, EyeIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

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
  createSavedViewAction,
  deleteSavedViewAction,
  setSavedViewDefaultAction,
  updateSavedViewAction,
} from '@/features/views/actions'
import { SaveViewDialog } from '@/features/views/SaveViewDialog'
import { sortSavedViews } from '@/features/views/saved-view-model'
import type { SavedView, SavedViewState, SavedViewSurface } from '@/types/saved-views'

/** The radio value for "no saved view applied", which is the surface's own default state. */
const NO_VIEW = 'none'

export type SavedViewsControlProps = {
  eventId: string
  surface: SavedViewSurface
  views: readonly SavedView[]
  /** What a new view would capture, and what Update overwrites the picked one with. */
  current: SavedViewState
  /** The view the table is showing, or `null` for the surface's own default state. */
  appliedId: string | null
  onApply: (view: SavedView | null) => void
  /** A reviewer may apply a stored view but never write one. */
  canEdit: boolean
}

export function SavedViewsControl({
  eventId,
  surface,
  views,
  current,
  appliedId,
  onApply,
  canEdit,
}: SavedViewsControlProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const ordered = sortSavedViews(views)
  const applied = ordered.find((view) => view.id === appliedId)

  // `startTransition(async () => ...)`. The synchronous-scope form this used to have
  // returned before the await, so React saw the transition finish in the same tick and
  // `pending` was false again immediately: the trigger and all four menu items below read
  // `disabled={pending}`, and none of it did anything. Delete view and Make default were
  // both double-submittable on Abstracts and the Agenda List. Now enforced by
  // `REACT_CORRECTNESS_RESTRICTED_SYNTAX` in eslint.restricted-syntax.mjs, which this file
  // was the last violation of.
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

  const save = (input: { name: string; isDefault: boolean }) => {
    setDialogOpen(false)
    run(
      async () =>
        await createSavedViewAction({
          eventId,
          surface,
          name: input.name,
          state: current,
          isDefault: input.isDefault,
        }),
      'Saved successfully',
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" disabled={pending} />}>
          {/* Both marked, because this trigger has an icon on each side of its label. The
              Button's cva trims the padding per side off these attributes
              (`has-data-[icon=inline-start]:pl-2`, `has-data-[icon=inline-end]:pr-2`), so
              the eye and the chevron sit optically level with the toolbar buttons beside
              them rather than 2px further in. */}
          <EyeIcon data-icon="inline-start" />
          Saved Views
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuRadioGroup
            value={appliedId ?? NO_VIEW}
            onValueChange={(next: string) => {
              onApply(next === NO_VIEW ? null : (ordered.find((view) => view.id === next) ?? null))
            }}
          >
            <DropdownMenuLabel>Saved Views</DropdownMenuLabel>
            <DropdownMenuRadioItem value={NO_VIEW}>All records</DropdownMenuRadioItem>
            {ordered.map((view) => (
              <DropdownMenuRadioItem key={view.id} value={view.id}>
                {view.name}
                {view.isDefault ? (
                  <span className="ml-auto text-xs text-muted-foreground">Default</span>
                ) : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={pending} onClick={() => setDialogOpen(true)}>
                  Save current view...
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={pending || applied === undefined}
                  onClick={() => {
                    if (applied === undefined) return
                    run(
                      async () =>
                        await updateSavedViewAction({
                          eventId,
                          surface,
                          viewId: applied.id,
                          state: current,
                        }),
                      'Saved successfully',
                    )
                  }}
                >
                  Update with current state
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={pending || applied === undefined || applied.isDefault}
                  onClick={() => {
                    if (applied === undefined) return
                    run(
                      async () =>
                        await setSavedViewDefaultAction({
                          eventId,
                          surface,
                          viewId: applied.id,
                        }),
                      'Saved successfully',
                    )
                  }}
                >
                  Make default
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={pending || applied === undefined}
                  onClick={() => {
                    if (applied === undefined) return
                    // Applied state is dropped first: leaving the id pointing at a deleted
                    // row would keep the table filtered by a view the menu no longer lists.
                    onApply(null)
                    run(
                      async () =>
                        await deleteSavedViewAction({ eventId, surface, viewId: applied.id }),
                      'View deleted',
                    )
                  }}
                >
                  Delete view
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit ? (
        <SaveViewDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          existing={ordered}
          pending={pending}
          onSave={save}
        />
      ) : null}
    </>
  )
}
