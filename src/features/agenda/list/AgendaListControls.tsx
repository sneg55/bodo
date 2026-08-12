'use client'

// The Agenda List's own toolbar controls.
//
// `SavedViewsControl` used to live here with three hardcoded entries and no persistence.
// It is now the shared `@/features/views/SavedViewsControl`, reading real SavedViews rows,
// and the Abstracts toolbar renders the same component.
//
// Neither control carries `order-1` any more. That class existed to push Drafts and Options
// past the `ml-auto` group that used to hold Columns / Sort / Filter; the toolbar now has a
// trailing slot of its own (`DataTableToolbar`), so DOM order is the rendered order.

import { FileTextIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function DraftsControl({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <Button variant={active ? 'secondary' : 'outline'} onClick={onClick}>
      <FileTextIcon data-icon="inline-start" />
      Drafts
    </Button>
  )
}

export function OptionsControl({ onExport }: { onExport: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        <span aria-hidden="true">···</span>
        Options
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onExport}>Export .CSV</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
