'use client'

// The footer bar: row count, pagination, and the "Show:" page-size control.
//
// The count reads "1 - 25 of 120 rows". The product renders that separator as a long
// dash; it is a plain hyphen here, per the transcription note in
// docs/parity/abstracts-review.md and the house rule against dashes in copy.

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { PAGE_SIZE_OPTIONS } from '@/components/primitives/data-table-types'
import { Button } from '@/components/ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from '@/components/ui/pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * A window of at most five page numbers around the current page, with an ellipsis
 * standing in for what is skipped. Returned as numbers plus nulls so the caller
 * renders one list rather than stitching three.
 */
function pageWindow(page: number, pageCount: number): readonly (number | null)[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }
  const first = 1
  const last = pageCount
  const from = Math.max(first + 1, Math.min(page - 1, last - 3))
  const to = Math.min(last - 1, Math.max(page + 1, first + 3))
  const middle = Array.from({ length: to - from + 1 }, (_, index) => from + index)

  return [
    first,
    ...(from > first + 1 ? [null] : []),
    ...middle,
    ...(to < last - 1 ? [null] : []),
    last,
  ]
}

export type DataTableFooterProps = {
  page: number
  pageSize: number
  totalRows: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

export function DataTableFooter({
  page,
  pageSize,
  totalRows,
  onPageChange,
  onPageSizeChange,
}: DataTableFooterProps) {
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize))
  const firstRow = totalRows === 0 ? 0 : (page - 1) * pageSize + 1
  const lastRow = Math.min(page * pageSize, totalRows)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-2 py-2">
      <p className="meta text-muted-foreground">
        {firstRow} - {lastRow} of {totalRows} rows
      </p>

      <Pagination className="mx-0 w-auto justify-start">
        <PaginationContent>
          <PaginationItem>
            <Button
              variant="ghost"
              size="icon"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeftIcon />
              <span className="sr-only">Previous page</span>
            </Button>
          </PaginationItem>
          {pageWindow(page, pageCount).map((entry, index) =>
            entry === null ? (
              // An ellipsis has no identity beyond its slot, so the index is the key.
              <PaginationItem key={`gap-${index}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={entry}>
                <Button
                  variant={entry === page ? 'outline' : 'ghost'}
                  size="icon"
                  aria-current={entry === page ? 'page' : undefined}
                  onClick={() => onPageChange(entry)}
                >
                  {entry}
                </Button>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <Button
              variant="ghost"
              size="icon"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRightIcon />
              <span className="sr-only">Next page</span>
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>

      <div className="flex items-center gap-1.5">
        <span className="meta text-muted-foreground">Show:</span>
        <Select
          // The one Select where the label IS the value, so the trigger read correctly
          // without this. Passed anyway, because the rule that catches the seven places it
          // did NOT read correctly cannot tell the difference, and an exception carved out
          // for the one honest case is how the rule stops being enforced.
          items={Object.fromEntries(PAGE_SIZE_OPTIONS.map((option) => [String(option), option]))}
          value={String(pageSize)}
          onValueChange={(next: string | null) => {
            if (next !== null) {
              onPageSizeChange(Number(next))
            }
          }}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
