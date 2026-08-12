// One provider's past runs, under its row in the registry.
//
// Deliberately NOT a `DataTable`. That primitive brings a search box, a preferences drawer
// and a paging footer, and three of them nested inside three provider rows would put nine
// toolbars on a settings page to list a handful of rows each. The shared table is for a
// surface that IS a list; this is a detail strip belonging to the row above it.
//
// Newest first is the read's own ordering (`runsNewestFirst` in reads-imports.ts), and a
// QUEUED run sorts first there rather than last, because a run with no timestamps is the
// one the organizer is waiting on. Nothing re-sorts here, so that ordering survives.

import { Badge } from '@/components/ui/badge'
import type { ImportRunRow } from '@/features/integrations/model'
import type { ImportStatus } from '@/types/imports'

/** Failure is the one state that has to be findable at a glance in a list of greys. */
const STATUS_VARIANT = new Map<ImportStatus, 'secondary' | 'outline' | 'destructive'>([
  ['queued', 'outline'],
  ['running', 'secondary'],
  ['done', 'secondary'],
  ['failed', 'destructive'],
])

export function ImportHistory({ runs, label }: { runs: readonly ImportRunRow[]; label: string }) {
  if (runs.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        No {label} import has run for this event yet.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {runs.map((run) => (
        <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
          <Badge variant={STATUS_VARIANT.get(run.status) ?? 'outline'}>{run.statusLabel}</Badge>
          <span className="text-sm">{run.countsText}</span>
          <span className="text-xs text-muted-foreground">{run.phaseLabel}</span>
          <span className="ml-auto text-xs text-muted-foreground">{run.whenText}</span>
          {run.error === undefined ? null : (
            // The error sits on its own line at full width rather than being truncated into
            // the row: it is the only thing on a failed run anybody needs, and a run that
            // failed on a 40-character message is not helped by seeing the first fifteen.
            <p className="w-full text-xs text-destructive">{run.error}</p>
          )}
        </li>
      ))}
    </ul>
  )
}
