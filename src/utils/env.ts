// Single env boundary for plain configuration values.
//
// Bindings (R2, KV, Durable Objects) are NOT here: they come from the Cloudflare
// context and live behind `src/utils/cf.ts`. This file is only for string/number
// config that arrives through `process.env`, which @opennextjs/cloudflare
// populates from wrangler vars and secrets.
//
// The schema lives in `env-schema.ts` and the cross-field rules in `env-checks.ts`; this
// file composes them and owns the two things that must stay in one place:
//
//   1. This file is the ONLY place `process.env` is read.
//      (The ESLint config enforces this via no-restricted-properties.)
//   2. Parsing is LAZY, not at import time. On Workers there is no startup phase
//      to fail fast in, and a module-level parse would run inside the first
//      request's isolate. `process.exit` does not exist there either.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { checkFeatureFlags, checkProduction } from '@/utils/env-checks'
import { baseSchema } from '@/utils/env-schema'

const envSchema = baseSchema.superRefine((env, ctx) => {
  if (env.DEPLOY_ENV === 'production') {
    checkProduction(env, ctx)
  }
  checkFeatureFlags(env, ctx)
})

export type Env = typeof envSchema._output

/**
 * Validate an arbitrary config source. The Worker entrypoint passes the
 * Cloudflare `env` object directly, because at that point `process.env` has not
 * been populated yet and waiting for a render to fail is a worse signal.
 */
export function parseEnv(source: unknown): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new AppError(
      ErrorIds.CFG_SCHEMA_FAIL,
      `invalid environment configuration:\n${lines.join('\n')}`,
      { issues: parsed.error.issues.length },
    )
  }
  return parsed.data
}

let cached: Env | undefined

export function getEnv(): Env {
  if (cached !== undefined) return cached
  cached = parseEnv(process.env)
  return cached
}

/** The absolute origin this deployment serves from. Never guessed. */
export function appUrl(): string {
  const env = getEnv()
  // Only reachable outside production, where the refine above requires it.
  return env.APP_URL ?? 'http://localhost:3000'
}

export const isProductionDeploy = (): boolean => getEnv().DEPLOY_ENV === 'production'

/**
 * A developer's own machine, under `next dev` or `cf:preview`.
 *
 * Exported rather than re-derived per call site because two of them now gate a
 * developer-only fallback (the in-memory claim guard in `src/utils/cf.ts`, and the
 * logged magic link in `/api/auth/magic`), and a fallback that is allowed to run on
 * a deployment is a security bug rather than a convenience.
 */
export const isLocalDeploy = (): boolean => getEnv().DEPLOY_ENV === 'local'

export const hasAirtable = (): boolean => {
  const env = getEnv()
  return env.AIRTABLE_TOKEN !== undefined && env.AIRTABLE_BASE_ID !== undefined
}

/**
 * Whether a provider is configured, or whether `sendEmail` will log instead.
 *
 * Per PROVIDER, not one global pair of keys. It read `RESEND_API_KEY` alone, so a
 * deployment configured for AgentMail would have passed every check, sent nothing, and
 * logged "not configured" once per message: the exact silent failure the `delivered`
 * flag exists to make visible.
 */
export const hasEmail = (): boolean => {
  const env = getEnv()
  if (env.EMAIL_FROM === undefined) return false
  if (env.EMAIL_PROVIDER === 'agentmail') return env.AGENTMAIL_API_KEY !== undefined
  return env.RESEND_API_KEY !== undefined
}

/**
 * Whether the click-to-sign-in demo door is open on this deployment.
 *
 * Every surface that exposes it gates on this: the buttons on /login, the route
 * handler behind them, and the banner that tells a visitor the data is shared. The
 * route answers 404 rather than 403 when it is false, so a deployment that never
 * enabled demo mode does not advertise an endpoint it refuses to serve.
 */
export const isDemoMode = (): boolean => getEnv().DEMO_MODE

/** Whether the Airtable scheduler traces its phases. See DIAG_AIRTABLE. */
export const isAirtableDiag = (): boolean => getEnv().DIAG_AIRTABLE

/** The three addresses the demo buttons sign in as, in one place. */
export const demoIdentityEmails = (): {
  admin: string
  reviewer: string
  speaker: string
} => {
  const env = getEnv()
  return {
    admin: env.DEMO_ADMIN_EMAIL,
    reviewer: env.DEMO_REVIEWER_EMAIL,
    speaker: env.DEMO_SPEAKER_EMAIL,
  }
}
