'use client'

// Driving one import run from the browser, one phase per request.
//
// THIS LOOP IS NOT AN OPTIMISATION, it is the only way a Sessionboard run finishes. There
// is deliberately no credential column on `ImportRuns` (BUILD_SPEC 5.0e, "Secrets"), so the
// cron sweep holds no organization token: it reports `no-client` and leaves the row
// `running` with a lapsed lease for a caller that does hold one. That caller is this tab.
// Sessionize and Accelevents runs could be left to the sweep, and are not, because an
// organizer watching a progress bar is the point of the run step.
//
// One phase per call, because `importRunDeps` sets `maxPhases: 1`: a phase is the largest
// unit of work that reliably fits under a Worker's CPU limit, and a limit hit mid-phase ends
// the phase rather than the run, since `dueImportRuns` hands a `running` row back once its
// lease lapses.
//
// The loop is BOUNDED by the number of phases plus one rather than by "until it says done",
// and that bound is load-bearing: `runImport` returning `advanced` forever would otherwise
// be an unbounded write loop against Airtable driven from a browser tab.

import { useCallback, useState } from 'react'

import { advanceImportAction, startImportAction } from '@/features/imports/actions'
import type { RunAttempt } from '@/features/imports/run'
import { shouldKeepAdvancing } from '@/features/imports/wizard-steps'
import {
  IMPORT_PHASES,
  type ImportCounts,
  type ImportMapping,
  type ImportPhase,
  type ImportSource,
  type ImportStatus,
  type NeedsEmailRow,
} from '@/types/imports'

export type ImportRunState = {
  runId?: string
  status: ImportStatus
  /** The phases this tab watched finish. What the progress bar is measured against. */
  phasesDone: readonly ImportPhase[]
  counts: ImportCounts
  needsEmail: readonly NeedsEmailRow[]
  /** How the last call ended, which is what the closing message is written from. */
  attempt?: RunAttempt
  error?: string
  busy: boolean
}

export type StartImportInput = {
  eventId: string
  source: ImportSource
  sourceRef: string
  mapping: ImportMapping
  /** Held in this tab for the length of the run and sent with every call. Never stored. */
  sessionboardToken?: string
}

const IDLE: ImportRunState = {
  status: 'queued',
  phasesDone: [],
  counts: {},
  needsEmail: [],
  busy: false,
}

/** Terminal for the ROW. Everything else leaves the row resumable by somebody. */
function statusFor(attempt: RunAttempt): ImportStatus {
  if (attempt === 'done') return 'done'
  if (attempt === 'failed') return 'failed'
  return 'running'
}

export function useImportRun(): {
  state: ImportRunState
  /** Resolves with how it ended, so the caller writes one toast rather than watching state. */
  start: (input: StartImportInput) => Promise<ImportRunState>
} {
  const [state, setState] = useState<ImportRunState>(IDLE)

  const start = useCallback(async (input: StartImportInput) => {
    // Mirrored in a local as well as in state, because every `setState` here is
    // asynchronous and the next iteration needs what the previous one accumulated. Reading
    // the phases back out of a closure over `state` would restart the count each time and
    // leave the bar stuck at one phase.
    let held: ImportRunState = { ...IDLE, status: 'running', busy: true }
    const publish = (next: ImportRunState): void => {
      held = next
      setState(next)
    }
    publish(held)

    const started = await startImportAction({
      eventId: input.eventId,
      source: input.source,
      sourceRef: input.sourceRef,
      mapping: input.mapping,
      sessionboardToken: input.sessionboardToken,
    })
    if (!started.ok) {
      publish({ ...IDLE, status: 'failed', error: started.message })
      return held
    }

    const absorb = (report: {
      attempt: RunAttempt
      phases: readonly ImportPhase[]
      counts: ImportCounts
      needsEmail: readonly NeedsEmailRow[]
      error?: string
    }): void => {
      publish({
        runId: started.runId,
        status: statusFor(report.attempt),
        phasesDone: [...held.phasesDone, ...report.phases],
        counts: report.counts,
        // An absent list must not erase one an earlier call already recorded: only the
        // speakers phase produces it, and the phases after it report nothing.
        needsEmail: report.needsEmail.length > 0 ? report.needsEmail : held.needsEmail,
        attempt: report.attempt,
        error: report.error,
        busy: shouldKeepAdvancing(report.attempt),
      })
    }

    absorb(started.report)

    for (let call = 0; call < IMPORT_PHASES.length + 1; call += 1) {
      if (!held.busy) break
      const next = await advanceImportAction({
        eventId: input.eventId,
        runId: started.runId,
        sessionboardToken: input.sessionboardToken,
      })
      if (!next.ok) {
        // The run ROW is untouched by a refused action, so the status stays `running`
        // rather than `failed`: what failed is this call, and the row is still resumable by
        // whoever picks it up next.
        publish({ ...held, busy: false, error: next.message })
        return held
      }
      absorb(next.report)
    }

    publish({ ...held, busy: false })
    return held
  }, [])

  return { state, start }
}
