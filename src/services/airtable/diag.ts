// Phase tracing for the Airtable scheduler, behind DIAG_AIRTABLE.
//
// Temporary by design: this exists to answer one question about the deployed Worker and
// should come out once it has. The question is which await a hung request is sitting on.
// Every Airtable-backed page started hanging at once for 50 to 90 seconds until the
// runtime cancelled the request, at 4-14ms of CPU with no exception and no log, and the
// only shared state on that path is the module-level admission queue in rate-window.ts.
//
// Two things follow, and they are the whole design of this file:
//
//   - It logs BEFORE each await, never after. A cancelled request never reaches a line
//     that runs after the await it died on, so anything logged on completion is logged
//     by exactly the requests that were fine.
//   - It does not use a timer. The leading suspect is that the isolate's timers stopped
//     firing, which is precisely what would make `clock.sleep` in rate-window.ts never
//     resolve, and a `setTimeout` watchdog would then be a second casualty rather than a
//     witness.
//
// `warn` and not `log` because biome.jsonc allows warn and error only, and this is a
// line somebody is meant to go looking for.

import type { SchedulerConfig } from '@/services/airtable/scheduler'
import { isAirtableDiag } from '@/utils/env'

/**
 * The tracer, or undefined when the flag is off, in which case `run` calls nothing.
 *
 * The PATH only, never the query string: that carries `filterByFormula`, which quotes
 * real values (a speaker's address, a submission code), and a Worker log is not the
 * place for them. The path still names the base and the table, which is the part that
 * makes a trace readable.
 */
export function phaseTracer(): SchedulerConfig['onPhase'] {
  if (!isAirtableDiag()) return undefined

  return (phase, target, attempt) => {
    console.warn(`[airtable] ${phase} attempt=${attempt} ${pathOf(target)}`)
  }
}

function pathOf(target: string): string {
  try {
    return new URL(target).pathname
  } catch {
    // A target that will not parse is still worth a line, so hand back what we got.
    return target
  }
}
