'use client'

// Step 2: one row per column in the file, each pointed at a speaker field or at nothing.
//
// Two columns of meaning, as the reference's mapping screen has: what the file calls it on the
// left, what bodo will store it as on the right. The sample values sit between them because
// the header alone is often not enough to tell what a column holds, which is the whole reason
// `sample-values.ts` exists.
//
// `Ignore this column` is the default for anything `autoMapHeaders` did not recognise, and it
// is a real choice rather than an absence: Sessionboard's own control "exists specifically to
// prevent overwriting existing data" (docs/parity/external-references.md), and an empty cell in
// a mapped column is dropped rather than written for the same reason (`mapRow`).

import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { sampleValues } from '@/features/crm/import/sample-values'
import {
  COLUMN_CHOICES,
  type ColumnChoice,
  IGNORE_COLUMN,
} from '@/features/crm/import/wizard-state'

export type ImportMapStepProps = {
  headers: readonly string[]
  rows: readonly Record<string, string>[]
  choices: ReadonlyMap<string, ColumnChoice>
  onChoose: (header: string, choice: ColumnChoice) => void
  disabled: boolean
}

export function ImportMapStep({ headers, rows, choices, onChoose, disabled }: ImportMapStepProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Column in your file</TableHead>
          <TableHead>Sample values</TableHead>
          <TableHead className="w-[16rem]">Speaker field</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {headers.map((header) => {
          const samples = sampleValues(rows, header)
          const choice = choices.get(header) ?? IGNORE_COLUMN
          return (
            <TableRow key={header}>
              <TableCell className="font-medium">
                {header === '' ? <span className="text-muted-foreground">(no name)</span> : header}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {samples.length === 0 ? (
                  'Empty'
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {samples.map((value, index) => (
                      // Keyed by value AND position: two identical samples are shown as two,
                      // because collapsing them would misrepresent the file
                      // (`sample-values.ts`), and the list is read-only, so nothing reorders.
                      <Badge key={`${value}-${index}`} variant="secondary" className="font-normal">
                        {value}
                      </Badge>
                    ))}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Select
                  value={choice}
                  items={COLUMN_CHOICES}
                  disabled={disabled}
                  onValueChange={(next: string | null) => {
                    if (next !== null) onChoose(header, next as ColumnChoice)
                  }}
                >
                  <SelectTrigger aria-label={`Speaker field for ${header}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUMN_CHOICES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
