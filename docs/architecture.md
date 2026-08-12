# Architecture

## The stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2.12, App Router, Turbopack |
| Runtime | Cloudflare Workers, via `@opennextjs/cloudflare` |
| Source of truth | Airtable |
| Files | Cloudflare R2 |
| Coordination | Durable Objects |
| Scheduling | Cloudflare Cron Triggers |
| Email | Resend |
| Model | Anthropic Claude |
| UI | shadcn/ui on Tailwind |

Airtable is the source of truth deliberately, not incidentally. The team this replaces
already runs automations off Airtable rows, so a shadow database would mean their existing
work stopped firing. There is no ORM and no second store.

## Layout

```
src/app/          routes and their route-local components: wire params, call, render
src/features/     one directory per feature area, with its logic, types and components
src/services/     external boundaries: airtable, ai, email, accelevents, storage, imports
src/components/   ui/ shadcn, primitives/ the shared building blocks, shell/ the chrome
src/utils/        the env boundary, the bindings accessor, small helpers
src/constants/    the error registry and the status vocabularies
src/entrypoints/  the custom Worker entrypoint
src/migrations/   the Airtable schema, as data
scripts/          schema provisioning, seeding, dev helpers
tests/            unit tests
```

The rule that keeps it navigable: **routes are thin**. A route directory may hold the
components only that screen uses, but the rules, the reads and the writes belong in
`src/features`, where they can be tested without rendering anything.

## Two constraints that shape everything

### Next is pinned to 16.2.12

On 16.3.0 with the current Cloudflare adapter, every page that awaits `params`,
`searchParams` or `cookies` hangs at runtime until the Workers runtime cancels the request. It
builds clean and fails only on a real request, so a build is not evidence. Do not upgrade
without re-testing on a deployed Worker.

### Cache Components is off

`cacheComponents` was tried and removed: the adapter cannot resume a partially prerendered
route, so a page whose dynamic half needed a resume hung, and a page servable from its static
shell returned 200 with its dynamic half silently missing. Both were reproduced on a deployed
Worker, not only in local preview.

What follows from that is the whole caching model: `'use cache'`, `cacheTag()` and
`cacheLife()` are unavailable, and caching lives **in the Airtable client** as tagged `fetch`
calls.

## Caching and invalidation

Each read declares its tags and its window in `src/services/airtable/read-cache.ts`, and the
client turns them into the request's `next: { tags, revalidate }`. Anything above that layer
is an ordinary async function composing those calls.

Tags are granular on purpose: `event:{id}:submissions`, `event:{id}:agenda`, `speaker:{id}`,
`submission:{id}`. Accepting one submission must not invalidate the agenda and every list.

Every write expires the tags it affects through `invalidate(origin, { own, others })` in
`src/services/airtable/invalidate.ts`, so one place decides what expiry means. Over-expiring
is treated as a defect, not a safe default.

Some reads are deliberately **uncached**, and each has a reason written at its declaration:
anything that decides whether a mutation is allowed, anything that decides what gets deleted,
and every queue's due-list, because a cached due-list hands a second sweep rows the first has
already sent.

## Authorization

- No passwords anywhere. `/login` mails a single-use link; consuming it is a Durable Object
  compare-and-swap, so a forwarded or prefetched link is accepted exactly once.
- Capability comes from an `EventMemberships` row, read per request. Never from a role in the
  session cookie.
- **Authorize in the Server Action or Route Handler**, not only in the layout. A layout is not
  a security boundary: a Next app has several entry points and a layout does not revalidate on
  every navigation. Portal mutations re-verify record ownership on the mutation.

## What Airtable cannot do, and how that is handled

Airtable has no transaction and no compare-and-swap. Everything in this product that must not
run twice concurrently goes through one mechanism:

**`claimOnce()`**, backed by the `ClaimGuard` Durable Object: one object per key, an atomic
claim with a lease.

| Must not run twice at once | Key |
|---|---|
| Consuming a magic link | the token |
| Sending an outbox row | the row |
| Delivering a webhook | the row |
| Pre-screening a submission | (round, submission) |
| Pushing an entity to Accelevents | the entity |
| Advancing an import run | the run |
| Running a CRM import | the run |
| Consuming an impersonation grant | the grant |
| Building a file bundle | the request |

Not KV, which is eventually consistent with no atomic compare-and-swap, so two callers can
both win. Not an Airtable status column, which has no transaction.

The pattern around it is always the same three protections: **claim** decides the owner, the
**lease expires** so a dead isolate does not strand the row, and an **idempotency key** or a
**mapping ledger** makes the resulting retry safe. Status and lease columns on the row are
visibility and fencing, not a fourth protection.

The lease is what makes the guarantee honest rather than absolute. Because a crashed worker's
row has to become claimable again, an operation that succeeded remotely and then died before
recording it can be retried. That is why the third protection is not optional: mail carries a
provider idempotency key, an Accelevents push carries a mapping ledger, and a webhook delivery
carries `X-Bodo-Delivery` so the receiver can drop a repeat. Where the collapse happens at the
far end, the delivery is at-least-once by design and says so.

## The Worker entrypoint

`wrangler.jsonc` points `main` at `src/entrypoints/worker.ts`, not at the generated OpenNext
worker, for three reasons:

1. Cloudflare will not deliver a cron trigger to a Worker with no `scheduled()` handler, and
   the generated worker exports only `fetch`. Without this file the crons would silently never
   fire.
2. Durable Object `class_name` resolves against the entry module, so the DO classes are
   re-exported here.
3. It dispatches the crons by calling the generated handler in-process with a constructed
   request. That is a direct function call, not a network self-fetch, and it is done this way
   because a job that writes has to invalidate cache tags, and `revalidateTag` only works
   inside the Next server context.

Job **logic** lives in a feature module rather than in the route: the sweeps in
`src/features/jobs/`, the import engine in `src/features/imports/sweep.ts`, the webhook drain
in `src/features/webhooks/deliver.ts`. The route handler wires and calls, so the schedule and
the admin's "run now" button share one implementation and the logic is unit-testable without
either entry.

Three schedules, deliberately few because Cloudflare caps triggers per Worker:

| Cron | Jobs |
|---|---|
| `*/2 * * * *` | AI pre-screen, imports, webhooks |
| `*/5 * * * *` | Reminders and the mail outbox |
| `17 * * * *` | Accelevents retry sweep |

## Bindings

| Binding | What |
|---|---|
| `BODO_UPLOADS` | R2 bucket for user files |
| `NEXT_INC_CACHE_R2_BUCKET` | R2 bucket for the incremental cache |
| `BODO_KV` | KV namespace |
| `BODO_CLAIM_GUARD` | The `ClaimGuard` Durable Object |
| `NEXT_TAG_CACHE_DO_SHARDED` | Sharded tag state |
| `NEXT_CACHE_DO_QUEUE` | Cache revalidation queue |

Features ask `src/utils/cf.ts` for a capability (`getUploadBucket()`, `getKv()`,
`claimOnce()`) and never touch a binding directly; plain environment values come only through
`src/utils/env.ts`.

At `DEPLOY_ENV=local` most capabilities fall back to an in-memory stand-in so the UI is
workable before any infrastructure exists. The fallback is gated on `DEPLOY_ENV` rather than
on whether the binding happened to be there, because falling back on absence means a
forgotten binding degrades production silently, and each capability says out loud whether
degrading is survivable.

Two answers are worth knowing. The **uploads bucket** has no stand-in at all, in any
environment: a no-op upload looks like success and loses the file, so the missing binding is
reported to the user instead. **KV** falls back even outside local, with a warning, because
its only job here is rate-limiting and a per-isolate limiter is worse than no service.

## Runtime rules

- **No Node.** No `fs`, no `Buffer`-dependent libraries, no module-level mutable state used as
  a cache. Isolates come and go.
- **Uploads stream to R2.** Never buffer a whole file.
- **A `setTimeout` does not outlive its request.** The runtime cancels continuations of a dead
  request, which is what makes queue work a cron's job rather than a fire-and-forget.
- **Never `redirect()` or `notFound()` inside a Suspense boundary.** A boundary resolves after
  the shell has flushed, so a redirect at that point never produces a response and the runtime
  cancels the request, and a `notFound()` renders the 404 body under an HTTP 200 status line.
  Resolve what can 404 in the page body. A route-level `loading.tsx` is itself such a
  boundary.

## UI

shadcn/ui is mandatory and enforced by lint: a hand-rolled `<button>`, a `fixed inset-0`
overlay, an outside-click listener, a hand-written `role="menu"`, or a direct
`@radix-ui/*` import is an error with a message naming the replacement.

Shared building blocks live in `src/components/primitives/`: the data table, the rich text
editor, the step wizard, the status chip, `ButtonLink`, and the scroll panel. Colours come
from theme tokens, never hardcoded, which is what lets both light and dark work.

`ButtonLink` exists because `<Button render={<Link/>}>` emits `<a role="button">` and, worse,
gives no feedback: every destination here is a dynamic route that reads Airtable, so a click
was followed by seconds of a bit-for-bit unchanged page. A control that looks identical
before and after you press it gets pressed again, and gets reported as broken. `Button` runs
code; `ButtonLink` goes somewhere and shows a pending state.

## Testing

Vitest, unit tests only, over 5,000 of them. The rules that are expensive to debug through
the UI ship with tests in the same change: conflict detection, score aggregation, conditional
field visibility, `.ics` generation, claim semantics, and every queue's selection policy.

Boundaries are tested through injected dependencies rather than a live base, because the
cases worth pinning are interleavings: two sweeps reaching one row, a model call that throws
after the attempt was stamped, a batch that fails after an earlier batch landed.
