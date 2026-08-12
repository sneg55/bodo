'use client'

// The list controls and the card grid (parity ref 05).
//
// A card grid rather than a DataTable, which BUILD_SPEC 5.1 is explicit about. Search,
// tab and sort are client state over rows the server already counted: the whole list is
// one Airtable read and filtering it in the browser costs nothing, where a round trip per
// keystroke would be the slow-SaaS feel the speed criterion is about.

import { PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createFormAction } from '@/features/forms/builder/actions'
import {
  FORM_SORT_LABELS,
  FORM_SORTS,
  type FormCardRow,
  type FormSort,
  type FormTab,
  filterForms,
  formTabCounts,
  sortForms,
} from '@/features/forms/builder/list-view'

import { FormCard } from './FormCard'

/** Value to label for the sort trigger. See the note at the `items` prop below. */
const SORT_ITEMS: readonly { value: FormSort; label: string }[] = FORM_SORTS.map((entry) => ({
  value: entry,
  label: FORM_SORT_LABELS.get(entry) ?? entry,
}))

const TAB_LABELS: readonly { value: FormTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
]

export type FormsListPanelProps = {
  eventId: string
  eventSlug: string
  rows: readonly FormCardRow[]
}

export function FormsListPanel({ eventId, eventSlug, rows }: FormsListPanelProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<FormTab>('all')
  const [sort, setSort] = useState<FormSort>('pending')
  const [pending, start] = useTransition()

  const counts = useMemo(() => formTabCounts(rows), [rows])
  const shown = useMemo(
    () => sortForms(filterForms(rows, { search, tab }), sort),
    [rows, search, tab, sort],
  )

  function create(): void {
    start(async () => {
      const result = await createFormAction({ eventId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      router.push(`/admin/${eventId}/forms/${result.formId}`)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          placeholder="Search forms..."
          className="w-56"
          onChange={(event) => setSearch(event.target.value)}
        />

        <Tabs
          value={tab}
          onValueChange={(next: string) => setTab(next as FormTab)}
          className="w-auto"
        >
          <TabsList variant="line">
            {TAB_LABELS.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
                <span className="ml-1 tabular-nums text-muted-foreground">
                  {counts.get(entry.value) ?? 0}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="ml-auto flex items-center gap-2">
          <Select
            value={sort}
            // `items` is what makes the trigger show "Most Pending" rather than the raw
            // value `pending`: base-ui's Select.Value renders the value unless it can look
            // a label up. Every Select in the builder whose value is an id needs this.
            items={SORT_ITEMS}
            onValueChange={(next: string | null) => {
              if (next !== null) setSort(next as FormSort)
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORM_SORTS.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {FORM_SORT_LABELS.get(entry)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* `Copy from...` and the footnote explaining why it was greyed are both GONE
              (2026-08-10). They were kept on the argument that the menu having two items is
              part of the surface and that a stated reason beats an unexplained grey. What
              they actually produced was a two-row menu with one usable row and a sentence
              about a scope boundary the organizer can do nothing with. Removed the same way
              `AddTaskButton` lost its identical pair, and for the same reason Exhibitors &
              Sponsors left Event Settings (BUILD_SPEC 5.0b).

              And the MENU went the same way (2026-08-11): what was left of ref 05's split
              button was a press to open a list holding one row, then a press on the only row
              there is. `Create Form` is what this button does, so it does it on the first
              press. It comes back as a `DropdownMenu` the day there is a second thing to
              choose. Same change, same day, as `AddTaskButton`. */}
          <Button disabled={pending} onClick={create}>
            <PlusIcon />
            Add
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No forms yet. Press Add to build your first one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((row) => (
            <FormCard key={row.id} row={row} eventId={eventId} eventSlug={eventSlug} />
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        <Link className="underline" href={`/admin/${eventId}/abstracts`}>
          Submissions land in Abstracts
        </Link>
        , filtered by the category routing sets.
      </p>
    </div>
  )
}
