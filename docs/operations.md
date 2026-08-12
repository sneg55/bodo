# Operations

Running bodo: locally, against a real base, and on Cloudflare.

## Local, with nothing configured

```bash
npm install
cp .env.example .env.local     # DEPLOY_ENV=local; everything else can stay empty
npm run dev                    # http://localhost:3000
```

At `DEPLOY_ENV=local` the app boots with **no secrets at all**. The data layer falls back to
local fixtures, most bindings fall back to in-memory stand-ins, and the AI surfaces run
canned. Every screen is workable before Airtable exists.

File upload is the exception: R2 has no stand-in, because a no-op upload would look like
success and lose the file, so the upload route reports the missing binding instead. Use
`npm run cf:preview` to exercise it.

At `DEPLOY_ENV=production` the schema inverts: every value a real user would hit becomes
mandatory and a deploy missing one fails on its first request rather than half-working.

`DEPLOY_ENV` rather than `NODE_ENV`, because `next build` and the Cloudflare preview both run
with `NODE_ENV=production`, so gating on that would make a local preview demand real
production secrets.

## Environment

| Variable | When | What |
|---|---|---|
| `DEPLOY_ENV` | always | `local`, `preview` or `production`. Sets the strictness |
| `APP_URL` | prod | The origin this deployment serves from. No default on purpose: a localhost fallback silently emails localhost links |
| `AIRTABLE_TOKEN` | prod | A personal access token, not a legacy API key |
| `AIRTABLE_BASE_ID` | prod | The base |
| `SESSION_SECRET` | prod | At least 32 characters. `openssl rand -hex 32` |
| `EMAIL_PROVIDER` | prod | `resend` or `agentmail` |
| `RESEND_API_KEY` | prod, unless `DEMO_MODE` | Needed when `EMAIL_PROVIDER=resend` |
| `AGENTMAIL_API_KEY` | with `agentmail` | Required whenever that provider is selected, demo or not |
| `EMAIL_FROM` | prod, unless `DEMO_MODE` | Must be on a verified sending domain |
| `R2_PUBLIC_BASE_URL` | prod | Where public reads of the uploads bucket are served from |
| `SEED_EMAIL_DOMAIN` | seeding | What domain seeded identities get addresses on |
| `PORTAL_EVENT_ID` | with Airtable | Which event the portal's unqualified URLs resolve to |
| `CRON_SECRET` | prod | Guards the cron routes. They are open URLs until it is set |
| `AI_MOCK` | always | `1` (default) runs canned AI. `0` requires `ANTHROPIC_API_KEY` |
| `ANTHROPIC_API_KEY` | when `AI_MOCK=0` | The model credential |
| `ACCELEVENTS_MOCK` / `ACCELEVENTS_API_KEY` | optional | The one-way sync |
| `DEMO_MODE`, `DEMO_ADMIN_EMAIL`, `DEMO_REVIEWER_EMAIL`, `DEMO_SPEAKER_EMAIL` | optional | One-click sign-in for a demo deployment |

Storage **access** is bindings, not URLs: R2, KV and the Durable Objects are configured in
`wrangler.jsonc`, and only plain values belong in the env. `R2_PUBLIC_BASE_URL` is the
exception and is not a way in: it is the public read origin that goes into the URLs bodo
hands out for headshots and slides.

Three files read these, and they are not the same file: `next dev` reads `.env.local`, the
Cloudflare preview reads `.dev.vars`, and the node scripts read `.env.local` or `.env`. A
value set in only one leaves the other half of the app looking for rows that do not exist.

## Against a real Airtable base

```bash
npm run airtable:schema:plan   # what would be created; no writes
npm run airtable:schema        # 42 tables, 345 fields; idempotent
npm run airtable:seed          # a demo event with submissions, speakers, rooms, tracks
```

Both are idempotent: a second schema run matches every table and field and creates nothing,
and a second seed creates no rows.

The token needs `schema.bases:read`, `schema.bases:write`, `data.records:read` and
`data.records:write`, **and** the base has to be added under the token's separate **Access**
panel. Scopes alone grant access to zero bases.

The seed's default email domain is `example.com`, which Resend refuses by name. Since a magic
link *is* the login, that default means no seeded speaker can sign in. Point
`SEED_EMAIL_DOMAIN` at a domain that accepts mail before seeding a base anyone will demo
from.

## Signing in

There are no passwords. `/login` posts an email address and mails back a single-use link.

For a demo deployment, `DEMO_MODE=1` adds one-click sign-in as the three configured
identities, which is how a judge or a colleague gets in without a mailbox.

## Deploying

```bash
npm run cf:build     # opennextjs-cloudflare build
npm run cf:preview   # run the real Workers build locally
npm run deploy       # ships .open-next, does NOT rebuild
```

Two things worth knowing:

- **`npm run deploy` does not rebuild.** Run `cf:build` first, or you ship the previous build.
- **`cf:preview` is worth the minute.** Several failure modes in this stack build clean and
  appear only on a real request.

First-time Cloudflare setup, the buckets, the KV namespace, the vars and the secrets, is
listed in the header comment of `wrangler.jsonc`.

## Scheduled work

Three cron triggers, deliberately few because Cloudflare caps them per Worker:

| Cron | Jobs |
|---|---|
| `*/2 * * * *` | AI pre-screen, imports, webhook deliveries |
| `*/5 * * * *` | Reminders and the mail outbox |
| `17 * * * *` | Accelevents retry sweep |

Every job is also reachable as a route, so an organizer's "run now" button and the schedule
share one implementation.

## Watching a deployment

```bash
npx wrangler tail --format json
```

What healthy looks like: `"outcome": "ok"`, `"exceptions": []`, and the `[airtable]`
`admitting` and `fetching` counts moving together. What a problem looks like: `canceled`
outcomes, or `admitting` far ahead of `fetching`, which means requests are queuing behind the
rate limiter.

## Checks

```bash
npm test           # unit tests
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run format     # biome
```

Lint on a large tree can exhaust the default heap:
`NODE_OPTIONS=--max-old-space-size=8192 npx eslint`.

## Rate limits and cost

Airtable allows about 5 requests per second per base, and the limiter that respects it is
module-scope, so the cap is **per isolate** rather than global. Lists paginate to completion
before they are cached and writes batch at ten.

Model calls are bounded in wall-clock time and use a cached prompt prefix, so a second
question about the same event does not pay for the digest again.
