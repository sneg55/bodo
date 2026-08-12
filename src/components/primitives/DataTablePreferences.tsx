'use client'

// The Preferences drawer. One Sheet, three tabs, and one explicit commit: nothing
// the drawer edits reaches the table until "Apply Changes" is pressed, which is the
// behaviour the audit inferred from the presence of that button.
//
// The draft lives in a child that is only mounted while the drawer is open, so
// closing it discards edits without an effect that has to guess when to resync.

import { CheckIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { DataTableColumnPicker } from '@/components/primitives/DataTableColumnPicker'
import { DataTableFilterPane, DataTableSortPane } from '@/components/primitives/DataTableRules'
import type {
  DataTableCatalog,
  FieldPill,
  DataTablePreferences as Preferences,
  PreferenceTab,
} from '@/components/primitives/data-table-types'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fieldsForPill } from '@/constants/fields'

/** @dnd-kit ships only to someone who opened the drawer. See BUILD_SPEC 6.3. */
const SelectedColumns = dynamic(
  () =>
    import('@/components/primitives/DataTableSelectedColumns').then(
      (module) => module.DataTableSelectedColumns,
    ),
  { ssr: false, loading: () => <Skeleton className="h-40 w-full" /> },
)

export type DataTablePreferencesSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: PreferenceTab
  onTabChange: (tab: PreferenceTab) => void
  preferences: Preferences
  /** Which field catalog this surface is built over. Supplied by `DataTable`. */
  catalog: DataTableCatalog
  /** The keys this surface can order and filter by. See DataTableRules. */
  sortableKeys?: ReadonlySet<string>
  onApply: (next: Preferences) => void
}

function PreferencesBody({
  initial,
  tab,
  catalog,
  onTabChange,
  sortableKeys,
  onApply,
}: {
  initial: Preferences
  tab: PreferenceTab
  catalog: DataTableCatalog
  onTabChange: (tab: PreferenceTab) => void
  sortableKeys?: ReadonlySet<string>
  onApply: (next: Preferences) => void
}) {
  const [draft, setDraft] = useState<Preferences>(initial)
  const [pill, setPill] = useState<FieldPill>('fields')

  const setColumnKeys = (columnKeys: readonly string[]) =>
    setDraft((current) => ({ ...current, columnKeys }))

  const toggleColumn = (key: string, selected: boolean) => {
    setColumnKeys(
      selected
        ? [...draft.columnKeys.filter((existing) => existing !== key), key]
        : draft.columnKeys.filter((existing) => existing !== key),
    )
  }

  const pillKeys = () => fieldsForPill(pill, catalog.fields).map((field) => field.key)

  // The one place the catalog and the surface's accessors are combined, so the Sort tab
  // and the Filter tab cannot end up offering different lists. `sortableKeys` selects out
  // of `catalog.fields` rather than out of `queryableFields`, and that is the whole point
  // of passing it: the keys a surface can answer in memory are not the keys that have a
  // real Airtable column behind them, and Ratings is exactly the field that differs.
  const queryable =
    sortableKeys === undefined
      ? catalog.queryableFields
      : catalog.fields.filter((field) => sortableKeys.has(field.key))

  return (
    <>
      <SheetHeader>
        <SheetTitle>Preferences</SheetTitle>
      </SheetHeader>

      <Tabs
        value={tab}
        onValueChange={(next: PreferenceTab) => onTabChange(next)}
        className="min-h-0 flex-1 px-4"
      >
        <TabsList variant="line">
          <TabsTrigger value="columns">
            Columns {draft.columnKeys.length}/{catalog.fields.length}
          </TabsTrigger>
          <TabsTrigger value="sort">Sort</TabsTrigger>
          <TabsTrigger value="filter">Filter</TabsTrigger>
        </TabsList>

        <TabsContent value="columns" className="min-h-0">
          <div className="grid min-h-0 gap-4 md:grid-cols-2">
            <DataTableColumnPicker
              pill={pill}
              onPillChange={setPill}
              fields={catalog.fields}
              selectedKeys={draft.columnKeys}
              onToggle={toggleColumn}
              onShowAll={() =>
                setColumnKeys([
                  ...draft.columnKeys,
                  ...pillKeys().filter((key) => !draft.columnKeys.includes(key)),
                ])
              }
              onHideAll={() => {
                const removed = new Set(pillKeys())
                setColumnKeys(draft.columnKeys.filter((key) => !removed.has(key)))
              }}
            />

            <div className="flex min-h-0 flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium tabular-nums">
                  Selected ({draft.columnKeys.length})
                </span>
                <Button
                  variant="link"
                  size="xs"
                  onClick={() => setColumnKeys([...catalog.defaultColumnKeys])}
                >
                  Reset to Default
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Drag to reorder columns</p>
              <SelectedColumns
                columnKeys={draft.columnKeys}
                fields={catalog.fields}
                onReorder={setColumnKeys}
                onRemove={(key) => toggleColumn(key, false)}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sort">
          <DataTableSortPane
            sort={draft.sort}
            fields={queryable}
            onChange={(sort) => setDraft((current) => ({ ...current, sort }))}
          />
        </TabsContent>

        <TabsContent value="filter">
          <DataTableFilterPane
            filters={draft.filters}
            fields={queryable}
            onChange={(filters) => setDraft((current) => ({ ...current, filters }))}
          />
        </TabsContent>
      </Tabs>

      <SheetFooter className="flex-row justify-end">
        <Button onClick={() => onApply(draft)}>
          <CheckIcon data-icon="inline-start" />
          Apply Changes
        </Button>
      </SheetFooter>
    </>
  )
}

export function DataTablePreferencesSheet({
  open,
  onOpenChange,
  tab,
  onTabChange,
  preferences,
  catalog,
  sortableKeys,
  onApply,
}: DataTablePreferencesSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-3xl!">
        {open ? (
          <PreferencesBody
            initial={preferences}
            tab={tab}
            catalog={catalog}
            onTabChange={onTabChange}
            sortableKeys={sortableKeys}
            onApply={(next) => {
              onApply(next)
              onOpenChange(false)
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
