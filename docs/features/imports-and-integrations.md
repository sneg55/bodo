# Imports and integrations

Getting an existing conference into bodo, and getting bodo's decisions out to the platform
that sells the tickets.

## Importing from another platform

`/admin/<event>/settings/integrations` starts an import. Three sources:

| Source | Brings | Note |
|---|---|---|
| **Sessionboard** | Sessions, speakers, tracks | Carries email addresses |
| **Accelevents** | Sessions, speakers | Carries email addresses |
| **Sessionize** | Sessions, speakers | No email addresses, by design on their side |

The three do not divide by API shape. They divide by whether the source carries an **email
address**, because that decides what happens at the end of the run: a Sessionboard or
Accelevents import produces speakers who can be sent a magic link the moment it finishes, and
a Sessionize import ends on a "needs email" list an organizer works through.

The wizard previews before it writes: what was found, how it maps, what will be created
versus updated, and what it could not resolve.

### Why a run engine

An import is a queued run advanced a phase at a time, for the same reason the mail outbox is
drained rather than sent inline: a whole conference does not fit in one request. Airtable has
no transaction and no compare-and-swap, so "read the queued runs, mark them running, import
them" is not safe either: two overlapping invocations read the same row, mark it, and both
import the event.

A run is advanced by the cron sweep, or by the authenticated action when the source needs a
credential the sweep does not hold.

Three protections, each covering what the others cannot:

1. **`claimOnce`**, keyed on the run, decides who owns it. Only the winner writes anything.
2. **The lease expires.** A run whose isolate died mid-phase is resumable at all only because
   of this, so a Workers CPU limit ends a *phase*, not the run.
3. **`IntegrationMappings`** makes the redo safe. Because a phase can be re-entered, the
   ledger of what has already been created turns a repeat into an update rather than a
   duplicate.

Progress is visible while it runs, phase by phase, because an organizer watching a migration
needs to see it move.

## Accelevents sync

One-way, out of bodo and into Accelevents, so an accepted speaker and session do not have to
be retyped into the registration platform.

It is push-per-entity: claim the entity, decide create versus update versus skip, call,
record the attempt in a sync log. A hash of the payload means an unchanged entity is skipped
rather than re-pushed.

The claim is the reason the design has one at all. A create is not idempotent, and the two
paths overlap **by design**: an organizer presses "Sync now" while the cron sweep is
mid-backlog. Without a lock keyed on the entity, both would POST, and the event would end up
with two remote sessions and two mappings for one submission. The second is the worse half,
because a duplicate mapping makes every later sweep abort before doing any work, which wedges
the integration silently.

Failed pushes are retried by a sweep that replays the snapshot recorded on the log row rather
than rebuilding the payload from current state, so a retry sends what was decided at the time
rather than what is true now.

There is a mock mode (`ACCELEVENTS_MOCK`), which is how the whole path is exercised without
credentials.

## Outbound webhooks

`/admin/<event>/settings/webhooks` registers an endpoint, a secret, and the events it wants:

- `submission.created`
- `submission.status_changed`
- `task.completed`
- `session.published`

Deliveries are signed (`X-Bodo-Signature`) and carry `X-Bodo-Event` and `X-Bodo-Delivery`, the
last being an idempotency key a receiver can use to drop a repeat.

Delivery is a queue drained by cron with the same claim-lease-retry shape as the mail outbox.
Two details are deliberate:

- The **body is snapshotted at enqueue**, so a retry three hours later sends what happened,
  not what is true now.
- The **endpoint is read at send time**, so a rotated secret signs the retry with the key the
  receiver is verifying with today.

A delivery whose subscription was deleted is retired to a terminal state rather than dropped,
because a dropped row keeps its queued status and is due again forever.

See [API](../api.md) for the inbound side.

## Where the logic lives

| Concern | File |
|---|---|
| Run engine and phases | `src/features/imports/run.ts`, `phases.ts` |
| Per-source normalization | `src/features/imports/normalize-*.ts` |
| Mapping ledger | `src/services/airtable/` integration mappings |
| Accelevents push | `src/services/accelevents/sync-attempt.ts` |
| Accelevents retry sweep | `src/features/jobs/accelevents-sync.ts` |
| Webhook dispatch and signing | `src/features/webhooks/dispatch.ts`, `deliver.ts` |
