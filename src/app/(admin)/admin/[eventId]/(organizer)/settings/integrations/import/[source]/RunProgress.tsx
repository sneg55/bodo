'use client'

// The run step's progress: where the import is, phase by phase, and what it has written.
//
// PHASES ARE THE UNIT, not records, and that is the engine's shape rather than a display
// choice. A 500-session event is hundreds of Airtable writes at 10 per batch under a ~5
// req/s per-base cap, which does not fit in one Worker request, so the run advances one
// phase per call and writes its progress back after each one. A CPU limit therefore ends a
// phase rather than the run.
//
// The order is the dependency order and it is worth showing: rooms, tracks and tags before
// speakers before sessions before the agenda, because a session cannot reference a track
// that does not exist yet.
//
// The bar is measured against the phases THIS TAB watched finish rather than against the
// row's `phase` column, since that column names the phase about to be worked on and a run
// picked up by the cron sweep between two calls would make the bar jump backwards.

import { CheckIcon, LoaderIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { importProgressPercent } from '@/features/imports/wizard-steps'
import {
  EMPTY_IMPORT_COUNT,
  IMPORT_ENTITY_TYPES,
  IMPORT_PHASE_LABELS,
  IMPORT_PHASES,
  type ImportCounts,
  type ImportPhase,
  type ImportStatus,
} from '@/types/imports'

const PHASE_LABEL = new Map<string, string>(Object.entries(IMPORT_PHASE_LABELS))

const ENTITY_LABEL = new Map<string, string>([
  ['room', 'rooms'],
  ['track', 'tracks'],
  ['tag', 'tags'],
  ['speaker', 'speakers'],
  ['submission', 'sessions'],
  ['participant', 'participants'],
])

export type RunProgressProps = {
  status: ImportStatus
  phasesDone: readonly ImportPhase[]
  counts: ImportCounts
  busy: boolean
  error?: string
  /** The closing sentence for however this attempt ended. Absent while it is still going. */
  message?: string
}

export function RunProgress({
  status,
  phasesDone,
  counts,
  busy,
  error,
  message,
}: RunProgressProps) {
  const done = new Set(phasesDone)
  const percent = importProgressPercent(status, phasesDone)
  const byEntity = new Map(Object.entries(counts))
  // The phase in flight is the first unfinished one in DEPENDENCY order, found by walking
  // the vocabulary rather than by comparing phase names: `IMPORT_PHASES` is ordered
  // metadata, speakers, submissions, agenda, and none of that survives a string comparison.
  const inFlight = IMPORT_PHASES.find((phase) => !done.has(phase))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {status === 'done' ? 'Finished' : status === 'failed' ? 'Stopped' : 'Importing'}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">{`${String(percent)}%`}</span>
        </div>
        <Progress value={percent} />
      </div>

      <ul className="flex flex-col gap-1.5">
        {IMPORT_PHASES.map((phase) => {
          const finished = done.has(phase)
          // Only while the tab is still calling: a stopped run has no phase in progress, it
          // has a phase it never reached, and a spinner on it would read as work still
          // happening.
          const running = busy && inFlight === phase
          return (
            <li key={phase} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {finished ? (
                  <CheckIcon className="size-4" />
                ) : running ? (
                  <LoaderIcon className="size-4 animate-spin" />
                ) : (
                  <span className="inline-block size-4" />
                )}
              </span>
              <span className={finished ? '' : 'text-muted-foreground'}>
                {PHASE_LABEL.get(phase) ?? phase}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap gap-1.5">
        {IMPORT_ENTITY_TYPES.map((entity) => {
          const count = byEntity.get(entity) ?? EMPTY_IMPORT_COUNT
          if (count.created + count.updated + count.skipped === 0) return null
          return (
            <Badge key={entity} variant="outline">
              {`${String(count.created)} new, ${String(count.updated)} updated ${ENTITY_LABEL.get(entity) ?? entity}`}
            </Badge>
          )
        })}
      </div>

      {error !== undefined && (
        <Alert variant="destructive">
          <AlertTitle>The import stopped</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {message !== undefined && error === undefined && (
        <p className="text-sm text-muted-foreground">{message}</p>
      )}
    </div>
  )
}
