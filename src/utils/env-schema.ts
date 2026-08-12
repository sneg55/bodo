// The env schema itself: every plain configuration value this app reads, and what it
// falls back to when absent.
//
// Split out of env.ts, which crossed the file-size limit when the AI flag landed. The
// three-file shape is schema (here) -> cross-field checks (env-checks.ts) -> the boundary
// that composes them and owns `process.env` (env.ts). The dependency arrows only point
// one way, so there is no cycle to unpick later.
//
// Rules that still live with the schema:
//   1. The schema is the source of truth for the `Env` type.
//   2. `DEPLOY_ENV` decides how strict validation is, NOT `NODE_ENV`. Both `next build`
//      and `opennextjs-cloudflare preview` run with NODE_ENV=production, so gating on it
//      would make a local preview demand real production secrets. DEPLOY_ENV defaults to
//      `local`, where everything a demo can run without is optional.
//   3. There is deliberately no default for APP_URL, because a localhost default does not
//      fail, it silently emails localhost magic links (Codex review finding 13).

import { z } from 'zod'

export const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Which deployment this is, and therefore how strict the rules below are.
  DEPLOY_ENV: z.enum(['local', 'preview', 'production']).default('local'),

  // No default: see rule 3. Optional here, required by the production check.
  APP_URL: z.string().url().optional(),

  // Airtable. `AIRTABLE_TOKEN` and not `AIRTABLE_API_KEY`: legacy Airtable API
  // keys are retired, so the credential is a personal access token or an OAuth
  // token, scoped `data.records:read`, `data.records:write`, `schema.bases:read`
  // (plus `schema.bases:write` for scripts/airtable-schema.ts) and granted
  // access to the one base. Absent means the DAL serves local fixtures.
  AIRTABLE_TOKEN: z.string().min(1).optional(),
  AIRTABLE_BASE_ID: z.string().min(1).optional(),

  // Sessions: absent means a dev-only ephemeral secret, so cookies do not
  // survive a restart.
  SESSION_SECRET: z.string().min(32).optional(),

  // Email: absent means send() logs the rendered message instead of sending.
  // EMAIL_FROM must be on a verified sending domain, not `resend.dev`, which
  // only delivers to the Resend account owner's own address (§7.3).
  //
  // `agentmail` is the second implemented adapter, and it is the one that makes the
  // mailbox side of this app testable: its inboxes are created by API call and can be
  // read back, so an emailed magic link or calendar invite can be checked for real
  // rather than asserted against a stub. There, EMAIL_FROM must be an address on an
  // inbox the key owns, because AgentMail takes the sender from the inbox rather than
  // from a header. See src/services/email/agentmail.ts.
  EMAIL_PROVIDER: z.enum(['resend', 'agentmail', 'cloudflare']).default('resend'),
  RESEND_API_KEY: z.string().min(1).optional(),
  AGENTMAIL_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),

  // Files: public read base for the BODO_UPLOADS bucket.
  R2_PUBLIC_BASE_URL: z.string().url().optional(),

  // Which event the speaker portal belongs to. BUILD_SPEC 5.6 settles on one
  // portal per event and the portal URLs carry no event id (docs/parity/
  // speaker-portal.md: the pill nav is /portal, /portal/submissions, ...), so the
  // scope has to come from configuration rather than the path. Absent means the
  // fixture event, which is what makes a fresh clone demo without a base; see
  // `portalEventId()` in src/features/portal/event-scope.ts, which refuses to
  // guess once a real base IS configured.
  PORTAL_EVENT_ID: z.string().min(1).optional(),

  // Accelevents: mock by default until a real test event exists.
  ACCELEVENTS_MOCK: z
    .enum(['0', '1'])
    .default('1')
    .transform((v) => v === '1'),
  ACCELEVENTS_API_KEY: z.string().min(1).optional(),

  // The AI surfaces (⌘K ask, pre-screen, dashboard proposal): canned by default so a
  // clone with an empty `.env` demonstrates all three, live once a key is configured and
  // the flag is turned off. Paired with the key in env-checks.ts for the same reason
  // ACCELEVENTS_MOCK is: a flag that says "live" while no key exists is a deploy that
  // looks configured and fails on the first click.
  AI_MOCK: z
    .enum(['0', '1'])
    .default('1')
    .transform((v) => v === '1'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(1).optional(),

  // Demo mode: sign in as a seeded identity by clicking a button, with no mailbox
  // in the loop. It exists for two situations that magic links serve badly, a
  // public online demo where a visitor has no inbox on this deployment, and local
  // debugging, where the fallback is reading a link out of the server log.
  //
  // Off unless asked for, and asked for by name rather than derived from
  // DEPLOY_ENV: a door that opens itself because some other setting changed is the
  // failure this flag is meant to avoid. `.env.example` ships it on, so a clone
  // demos immediately while a deploy stays shut until someone sets it.
  //
  // What it does NOT do is invent an identity. The three addresses below are
  // resolved through the same `resolveLoginSubject` the magic link uses, so demo
  // mode changes how a visitor proves who they are and never who exists. An
  // address with no row signs nobody in. See src/features/auth/demo-login.ts.
  DEMO_MODE: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),

  // Defaults are the fixture identities from src/services/airtable/fixtures/event.ts,
  // so a fresh clone with DEMO_MODE=1 and an empty `.env` works with no further
  // configuration. A deployment against a real base points them at real rows.
  DEMO_ADMIN_EMAIL: z.string().min(1).default('organizer@example.com'),
  DEMO_REVIEWER_EMAIL: z.string().min(1).default('reviewer1@example.com'),
  DEMO_SPEAKER_EMAIL: z.string().min(1).default('ada@example.com'),

  // Phase tracing for the Airtable scheduler, for a failure that leaves nothing to read:
  // every Airtable-backed page hanging at once for 50-90s until the runtime cancels it,
  // at 4-14ms of CPU with no exception and no log. See the header of scheduler.ts's
  // `onPhase` for what it prints and why it prints before each await rather than on a
  // timer. Off by default; turn it off again once it has answered its question.
  DIAG_AIRTABLE: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
})

/** The parsed shape, before the cross-field checks in env-checks.ts run. */
export type EnvInput = z.infer<typeof baseSchema>
