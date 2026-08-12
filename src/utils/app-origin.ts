// Does APP_URL name the origin this deployment actually serves from?
//
// Split out of `src/utils/env.ts` rather than living beside `appUrl()` because it
// is a different job: env.ts validates configuration in isolation, this compares
// one configured value against a live request. It is a pure function of
// (request URL, parsed env) so the Worker entrypoint can call it on the first
// request of an isolate and `tests/app-origin.test.ts` can pin the rules.
//
// Why it exists at all: nothing else notices when APP_URL is wrong. `appUrl()` is
// resolved server side precisely so a client cannot guess its own origin, so a
// wrong value never errors. It silently bakes a dead host into embed snippets,
// magic links, portal links and .ics URLs. An eval run against this app lost every
// generated `<iframe src>` to exactly that: `.dev.vars` said 8788, the Worker
// answered on 8787, and the only symptom was that a copy-pasted embed rendered
// nothing.

import type { Env } from '@/utils/env'

/**
 * The verdict. `fatal` decides whether the caller throws or only logs, and the
 * asymmetry is deliberate: off a production deploy a 500 on the first request is
 * the fastest way to learn about it and nothing is at stake, whereas a deployed
 * Worker legitimately answers on hosts that are not the canonical one (a
 * `*.workers.dev` subdomain alongside a custom domain, a preview alias), so taking
 * the whole site down over a link-building setting would be the worse failure.
 */
export type OriginCheck = { ok: true } | { ok: false; fatal: boolean; message: string }

/**
 * 127.0.0.1, ::1 and localhost are the same machine, and which one a developer
 * types is not a misconfiguration. Everything else compares literally, port
 * included, because the port is the half that was wrong.
 */
function normalizeOrigin(url: URL): string {
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1'
  return `${url.protocol}//${loopback ? 'localhost' : url.hostname}:${url.port}`
}

export function checkServingOrigin(requestUrl: string, env: Env): OriginCheck {
  // No APP_URL is a different defect and the schema already rules on it: required
  // at DEPLOY_ENV=production, a documented fixture fallback below that. Nothing to
  // compare.
  if (env.APP_URL === undefined) return { ok: true }

  let configured: URL
  let serving: URL
  try {
    configured = new URL(env.APP_URL)
    serving = new URL(requestUrl)
  } catch {
    // An unparseable APP_URL cannot reach here (the schema is `z.string().url()`),
    // and an unparseable request URL is not this check's business.
    return { ok: true }
  }

  if (normalizeOrigin(configured) === normalizeOrigin(serving)) return { ok: true }

  return {
    ok: false,
    fatal: env.DEPLOY_ENV !== 'production',
    message:
      `APP_URL is ${env.APP_URL} but this Worker is answering on ${serving.origin}. ` +
      'Every generated link (embed snippets, magic links, portal links, .ics URLs) ' +
      'points at an origin nothing is serving.',
  }
}
