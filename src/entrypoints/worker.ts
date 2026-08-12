// Custom Worker entrypoint. `wrangler.jsonc` points `main` here, NOT at
// `.open-next/worker.js`.
//
// Why this file exists at all: the OpenNext-generated worker exports only
// `fetch`. Cloudflare will not deliver a Cron Trigger to a Worker that has no
// `scheduled()` handler, so `triggers.crons` in wrangler.jsonc was declaring
// schedules that could never fire, and BUILD_SPEC's reminder queue and
// Accelevents retry sweep would silently never run. (Codex review finding 1.)
//
// Three jobs, then:
//   1. Delegate every request to the generated Next worker, unchanged.
//   2. Re-export the Durable Object classes, because wrangler resolves DO
//      `class_name` against the entry module and the generated worker is no
//      longer it.
//   3. Dispatch Cron Triggers.
//
// On cron dispatch: the schedules are routed into the Next server by calling the
// generated handler in-process with a constructed Request. That is not a network
// self-fetch (no DNS, no TLS, no public route), it is a direct function call, so
// the two objections to loopback HTTP do not apply. It is done this way rather
// than importing the job functions directly because a job that writes has to
// invalidate cache tags, and `revalidateTag` only works inside the
// Next server context. The job LOGIC lives in `src/features/jobs/*`, which the
// route handlers call, so the schedule and the admin "run now" button share one
// implementation and the logic stays unit-testable without either entry.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { checkServingOrigin } from '@/utils/app-origin'
import { parseEnv } from '@/utils/env'

import rawHandler from '../../.open-next/worker.js'

// Durable Object classes, re-exported because wrangler resolves DO `class_name`
// against the entry module. The first three are OpenNext's; ClaimGuard is ours.
export { ClaimGuard } from '@/services/guard/claim-guard'
export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from '../../.open-next/worker.js'

/**
 * The slice of Cloudflare's execution context this file touches. Declared locally
 * rather than pulled from `ExecutionContext`, because that global only exists once
 * `npm run cf:typegen` has written the (gitignored) worker-configuration.d.ts, and
 * `tsc --noEmit` has to pass in a fresh clone before any Cloudflare setup.
 */
type WorkerContext = {
  waitUntil: (promise: Promise<unknown>) => void
  passThroughOnException: () => void
}

// The generated worker is untyped JavaScript and does not exist until `cf:build`
// has run, so its shape comes from the ambient shim in open-next-worker.d.ts.
// That shim, not this file, is where the assumption about the generated module is
// recorded, and it is what lets `tsc --noEmit` pass in a fresh clone.
const handler = rawHandler

/**
 * Cron expression to route. Keys must match `triggers.crons` in wrangler.jsonc
 * exactly, character for character: Cloudflare hands back the literal string it
 * was configured with, so a reformatted expression here silently stops matching.
 */
const CRON_ROUTES = new Map<string, readonly string[]>([
  ['*/5 * * * *', ['/api/cron/reminders']],
  ['17 * * * *', ['/api/cron/accelevents']],
  // Two jobs on one schedule, and the list is why this maps to an ARRAY rather than to a
  // path. Cloudflare caps the number of cron triggers per Worker, so a third job does not
  // get a third expression for free, and both of these want the same tight cadence for
  // the same reason: somebody is WATCHING. An organizer presses pre-screen and reads a
  // progress line, and an organizer running an import watches it advance a phase at a
  // time. Ten pre-screen jobs every two minutes finishes a forty-abstract round inside a
  // demo; an import makes progress once per invocation, so the interval multiplies by the
  // number of phases to become the floor on how long the whole import can take.
  // Three jobs now, and webhooks joins THIS expression rather than taking one of its own for
  // exactly the reason the paragraph above gives: Cloudflare caps triggers per Worker, and a
  // fourth job does not get a fourth expression for free. Two minutes is also the right
  // cadence on its own merits: a webhook is a notification somebody is waiting on in Discord,
  // so the delay between an acceptance and the message is the thing being judged.
  ['*/2 * * * *', ['/api/cron/prescreen', '/api/cron/imports', '/api/cron/webhooks']],
])

/**
 * Config is validated once per isolate rather than per request. This is a
 * validation latch, not a data cache, so it does not break the "no module state"
 * rule: a fresh isolate simply revalidates.
 */
let configChecked = false
let originChecked = false

function assertConfigOnce(env: unknown): void {
  if (configChecked) return
  // Throws AppError(CFG_SCHEMA_FAIL) listing every missing key. At
  // DEPLOY_ENV=production that includes APP_URL, the Airtable token, the session
  // secret, email credentials, the R2 public base, and CRON_SECRET. Deliberately
  // loud: a deploy missing any of them cannot serve a working magic link, and a
  // 500 in `wrangler tail` on the first request is a better signal than emailing
  // links to localhost.
  parseEnv(env)
  configChecked = true
}

/**
 * The half of configuration a schema cannot check on its own: whether APP_URL names
 * the origin this Worker is actually answering on. Needs a live request, so it runs
 * here rather than in the schema, once per isolate on the same latch as the rest.
 *
 * Runs before the first response is produced, which is the closest thing a Worker
 * has to boot time. See `checkServingOrigin` for why it throws locally and only
 * logs on a production deploy.
 */
function assertServingOriginOnce(request: Request, env: unknown): void {
  if (originChecked) return
  originChecked = true

  const verdict = checkServingOrigin(request.url, parseEnv(env))
  if (verdict.ok) return

  if (verdict.fatal) {
    throw new AppError(ErrorIds.CFG_ORIGIN_MISMATCH, verdict.message, { url: request.url })
  }
  console.error(`[${ErrorIds.CFG_ORIGIN_MISMATCH}] ${verdict.message}`)
}

const worker = {
  async fetch(request: Request, env: unknown, ctx: WorkerContext): Promise<Response> {
    assertConfigOnce(env)
    assertServingOriginOnce(request, env)
    return await handler.fetch(request, env, ctx)
  },

  async scheduled(
    controller: { cron: string; scheduledTime: number },
    env: unknown,
    ctx: WorkerContext,
  ): Promise<void> {
    assertConfigOnce(env)

    const paths = CRON_ROUTES.get(controller.cron)
    if (paths === undefined) {
      // A schedule was added to wrangler.jsonc without a route here.
      console.error(`[cron] no route registered for schedule "${controller.cron}"`)
      return
    }

    const config = parseEnv(env)
    const origin = config.APP_URL ?? 'http://localhost:3000'

    // In series, not in parallel, and deliberately: two jobs sharing a schedule also share
    // one Airtable base, and section 3.1 caps that base at roughly five requests per second
    // for both of them together. Running them concurrently would double the burst and make
    // each one back off against the other. A job that throws must not take its neighbour
    // down with it either, so each is awaited and reported on its own.
    for (const path of paths) {
      const request = new Request(new URL(path, origin), {
        method: 'POST',
        headers: {
          // The same shared secret the route handler requires from the admin
          // "run now" button, so the handler has exactly one auth path.
          'x-cron-secret': config.CRON_SECRET ?? '',
          'x-cron-schedule': controller.cron,
        },
      })

      const response = await handler.fetch(request, env, ctx)
      if (!response.ok) {
        console.error(
          `[cron] ${path} returned ${String(response.status)}: ${await response.text()}`,
        )
      }
    }
  },
}

export default worker
