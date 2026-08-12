// Console output and credential loading for the two Airtable scripts.
//
// Writes to the streams directly rather than through `console`, because a script's
// normal progress is not a warning and stdout is where a caller expects to pipe it.
//
// The credentials go through `getEnv()` and never through a literal or an argv flag:
// a token pasted on a command line lands in the shell history of whoever ran it, and
// nothing here ever prints one back, not even truncated.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getEnv } from '@/utils/env'

export const say = (message: string): void => {
  process.stdout.write(`${message}\n`)
}

/** A count with its noun, so no caller has to think about the plural. */
export const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

export type Credentials = { baseId: string; token: string }

/**
 * The token and base id, or a message naming exactly what is missing.
 *
 * The token needs `schema.bases:read` and `schema.bases:write` for the schema
 * script and `data.records:read` plus `data.records:write` for the seed, scoped to
 * this one base. Airtable's legacy API keys are retired, so it is a personal access
 * token, which is also why the variable is AIRTABLE_TOKEN and not AIRTABLE_API_KEY.
 */
export function credentials(): Credentials {
  const env = getEnv()
  const missing = [
    ...(env.AIRTABLE_TOKEN === undefined ? ['AIRTABLE_TOKEN'] : []),
    ...(env.AIRTABLE_BASE_ID === undefined ? ['AIRTABLE_BASE_ID'] : []),
  ]
  if (env.AIRTABLE_TOKEN === undefined || env.AIRTABLE_BASE_ID === undefined) {
    throw new AppError(
      ErrorIds.CFG_ENV_MISSING,
      `${missing.join(' and ')} must be set. Put them in .env, or export them, then run again.`,
      { missing: missing.length },
    )
  }
  return { baseId: env.AIRTABLE_BASE_ID, token: env.AIRTABLE_TOKEN }
}

/**
 * Run a script body and turn a failure into one readable line plus a non-zero exit.
 *
 * `process.exitCode` rather than `process.exit`, so a pending write to stdout is
 * flushed instead of being cut off with the explanation half printed.
 */
export function run(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`failed: ${message}\n`)
    process.exitCode = 1
  })
}
