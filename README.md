# bodo

Open-source speaker and session operations for conferences. Collect proposals, review and
score them, decide, tell people, and publish a schedule.

Built as a replacement for [Sessionboard](https://www.sessionboard.com/), for a team paying
more than $40k a year for a subset of it.

**Live:** https://bodo.nsawinyh.workers.dev · **Docs:** [`docs/`](docs/README.md)

---

## What it does

| | |
|---|---|
| **Call for papers** | A form builder with 15 field types, conditional logic, cross-field character limits, and rules that route a submission to a track based on its answers. Public submission page, no account needed to start, drafts that survive a closed tab. |
| **Speaker portal** | Passwordless. Bio, headshot, slides, submissions, tasks and a speaker handbook, scoped to the person across every event they appear on. |
| **Review and scoring** | Multi-round, configurable criteria (numeric, weighted select, comment), weighted aggregation that carries the reviewer count, conflict-of-interest recusal, and staged accept and decline queues committed by a single Notify step that queues the mail with the decision. |
| **Agenda** | Drag and drop into rooms and times, six views, conflict detection for double-booked rooms and for one person in two places, auto-schedule for the first pass, and publish as a separate act from schedule. |
| **Communications** | Templated mail with per-recipient merge fields, bulk send from any selection, automated reminder sweeps, and standards-compliant `.ics` invites that stay updatable after the room changes. |
| **Onboarding** | Tasks addressed to a person or to one of their sessions, file requests with delivery counters, and a status dashboard that refreshes itself. |
| **Speaker CRM** | A cross-event contact database with saved shareable lists, a sourcing pipeline, CSV import with column mapping and duplicate detection, append-only notes, and duplicate merging. |
| **Public and embeddable** | A public event site, plus five embeddable views in five formats (styled HTML, basic HTML, JSON, XML, iCal) for the event's own website. |
| **API** | Bearer-authenticated REST, an MCP server, and signed outbound webhooks. |
| **AI** | Ask questions about the event in ⌘K with every answer citing the rows behind it, pre-screen a review round, and build a dashboard from a description. All three run without an API key. |

Full detail per area in [`docs/`](docs/README.md).

## Quick start

```bash
npm install
cp .env.example .env.local     # DEPLOY_ENV=local; everything else can stay empty
npm run dev                    # http://localhost:3000
```

At `DEPLOY_ENV=local` the app boots with **no secrets at all**: the data layer serves local
fixtures, most Cloudflare bindings fall back to in-memory stand-ins, and the AI surfaces run
canned against the fixture data. Every screen is workable before Airtable exists.

The one capability that needs real infrastructure is file upload. R2 has no local stand-in on
purpose, because a no-op upload would look like success and lose the file; run
`npm run cf:preview` when you need to exercise it.

Against a real base:

```bash
npm run airtable:schema:plan   # what would be created; no writes
npm run airtable:schema        # 42 tables, 345 fields; idempotent
npm run airtable:seed          # a demo event with submissions, speakers, rooms, tracks
```

Deploying, and the environment variables that become mandatory when you do, are in
[docs/operations.md](docs/operations.md).

## Stack

Next.js 16.2.12 (App Router, Turbopack) on **Cloudflare Workers** via
`@opennextjs/cloudflare`, with **Airtable** as the source of truth, **R2** for files,
**Durable Objects** for the coordination Airtable cannot do, **Cron Triggers** for scheduled
work, **Resend** for mail, and **Claude** for the AI surfaces. UI is shadcn/ui on Tailwind.

Two constraints are load-bearing and both are explained in
[docs/architecture.md](docs/architecture.md):

- **Next is pinned to 16.2.12.** On 16.3.0 with the current adapter, any page awaiting
  `params`, `searchParams` or `cookies` hangs at runtime. It builds clean, so a green build is
  not evidence.
- **Cache Components is off**, so `'use cache'`, `cacheTag()` and `cacheLife()` are
  unavailable. Caching lives in the Airtable client as tagged `fetch` calls, declared in
  `src/services/airtable/read-cache.ts`, and every write expires the tags it affects.

## Built beyond the original ask

The brief listed nine features, later amended to add a speaker CRM, with a public API named
as a bonus. All eleven are built. [docs/beyond-the-brief.md](docs/beyond-the-brief.md) is the
full accounting; the headlines:

**Capabilities nobody asked for**

- **An MCP server.** Four read-only tools over the same API token, so "who still owes me a
  headshot" is answerable from a terminal or a chat client. It is requirement 6's dashboard,
  delivered where a lot of this work now actually happens. Read-only on purpose: an agent that
  can accept a submission on its own is not something to point at a live conference.
- **Migration in.** The brief covered pushing data out and never asked how a conference
  already running on Sessionboard, Sessionize or Accelevents gets its programme *in*. An
  import engine with three source adapters, a preview step, and a ledger that makes a re-run
  safe rather than duplicating.
- **Two more AI surfaces** beyond the one the brief called "very optional": ⌘K ask with
  citation resolution that drops anything the model was not actually shown, and a dashboard
  proposed from plain English.
- **Auto-schedule**, so the first pass of an agenda is a starting grid rather than hours of
  dragging.
- **Duplicate detection twice over**: near-identical submissions surfaced before they reach
  two sets of reviewers, and speaker-record merging that repoints every link before deleting
  anything.
- **Demo mode and impersonation**, because magic-link auth is correct and is also a wall in
  front of anyone evaluating the product, and because "it looks wrong on my portal" is
  answered by looking at their portal.

**Depth inside the asked-for features:** reviewer recusal, reviewer counts carried with every
average, decisions staged so that "decided but not yet told" is a state you can sit in,
session content status with version history, file versions and comment threads, streamed bulk
download, tasks addressed to a session rather than only a person, a portal scoped to the
person across events, a full email history per person across every event, saved views,
per-event branding, team management, and a theme that follows the machine.

**Guarantees the brief never mentioned:** a Durable Object compare-and-swap behind all six
operations that must not happen twice, one shared definition of "published" behind every
public surface, a central error-id registry, granular cache tags, over 5,000 unit tests
concentrated on the rules that fail silently, and lint that enforces the architecture rather
than describing it.

## Repository layout

```
src/app/          routes and their route-local components: a page wires params and renders
src/features/     one directory per feature area, with its logic, types and components
src/services/     external boundaries: airtable, ai, email, accelevents, storage, imports
src/components/   ui/ shadcn, primitives/ the shared building blocks, shell/ the chrome
src/utils/        the env boundary, the bindings accessor, small helpers
src/constants/    the error registry and the status vocabularies
src/entrypoints/  the custom Worker entrypoint: fetch delegation, cron dispatch, DO exports
src/migrations/   the Airtable schema, as data
scripts/          schema provisioning, seeding, dev helpers
tests/            unit tests
docs/             the documentation this README links to
```

## Checks

```bash
npm test           # unit tests
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run format     # biome
```

## License

MIT. See [LICENSE](LICENSE).

## Divergence from Sessionboard

Deliberate, not accidental:

- **Auth is passwordless magic links.** Sessionboard uses passwords plus SSO and passkeys.
  Magic links avoid storing password hashes and double as the confirmation-email bridge into
  the portal.
- **Payments, fees, invoices, exhibitors, sponsors and marketing are out of scope.** bodo is
  speaker operations.
- **The palette differs while the layout matches.** Colours come from theme tokens rather than
  Sessionboard's blues, so both light and dark work; shape, control inventory and copy follow
  the original.
- **Navigation entries for out-of-scope areas still render**, because an organizer's muscle
  memory is part of what is being replaced. Each lands on a page saying what it is rather than
  a 404.
