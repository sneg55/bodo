# Communications

Every message bodo sends, and the machinery that makes sure it is sent once.

## Templates

`/admin/<event>/settings/email-templates` holds the editable templates: acceptance,
decline, the draft reminder before a form closes, the two admin alerts (a submission arrived,
a speaker edited one) and the portal invitation.

Each is authored as markdown with a subject line, carries per-recipient merge fields, and can
be previewed against a real row before it goes anywhere. Templates that have not been
customized fall back to shipped defaults, so a fresh event can send mail on day one.

## Sending

Three ways a message leaves:

- **Notify**, from the review queues, which commits the decision and queues the mail as one
  action. See [Review and scoring](review-and-scoring.md).
- **Bulk email**, from a selection anywhere a selection exists: abstracts, speakers, the CRM
  directory. The composer shows the audience, resolves merge fields per recipient and
  previews before sending.
- **Automated reminders**, on a schedule: outstanding speaker tasks, and draft submissions
  before a form's close date.

Two nudges are deliberately a button rather than a sweep, because the judgement about when to
chase is the organizer's: a reviewer who is behind on assignments, and a speaker who has not
delivered a requested file.

Nothing is sent inline from a request. Everything goes to an outbox table and is drained by a
cron trigger.

## Why an outbox

Airtable has no transaction and no compare-and-swap, so "read the queued rows, mark them
sending, send them" is not safe: two overlapping cron invocations read the same row. Marking
after the send loses mail when the isolate dies in between; marking before it duplicates mail
when the provider call fails after delivering.

Three independent protections, each covering what the others cannot:

1. **`claimOnce`**, a Durable Object with one id per row, decides who owns the row. Only the
   winner sends. This is the compare-and-swap Airtable lacks.
2. **The lease expires**, so a sender that crashed mid-flight releases the row instead of
   stranding it forever.
3. **The provider gets an idempotency key**, which is what makes protection 2 safe: a retry
   after a crashed-but-delivered send collapses at the provider rather than arriving twice.

The row's own `status`, `leaseHolder` and `leaseExpiresAt` columns are not a fourth
protection. They exist for visibility (an operator can tell an in-flight send from a stuck
queue) and for fencing, so a sender that lost its lease cannot overwrite the outcome recorded
by the sender that replaced it.

Failures are retried with a cap and a terminal `dead` state, and the reason is written on the
row in the column an organizer would look at.

## Calendar invites

Scheduled sessions produce standards-compliant `.ics` invites, attached to the mail rather
than linked, which is the form Gmail, Outlook and Apple Calendar all consume as a real
calendar event rather than as a file.

The constraint that shapes the implementation: the room is assigned *after* the first invite
goes out, so an already-sent invite must be updatable. `src/features/comms/ics.ts` keeps the
UID stable across sends, bumps `SEQUENCE` on every change, supports cancellation, and gets the
escaping and the 75-octet line folding right. All four are unit tested, because all four fail
silently in a calendar client rather than loudly in a test.

## Email history

`/admin/<event>/email-history` is the log: what was sent, to whom, when, with what status,
and what the provider said. A speaker's own timeline in the CRM shows the same rows filtered
to them, across every event they appear in, which is the question "what have we already told
this person" that otherwise requires searching someone's sent folder.

## Providers

Resend by default. The provider is behind `src/services/email`, selected by
`EMAIL_PROVIDER`, and there is a no-op provider for local development so a clone with no keys
still exercises the whole path up to the send.

## Where the logic lives

| Concern | File |
|---|---|
| Outbox drain, claiming and fencing | `src/features/comms/drain.ts`, `outbox-lease.ts` |
| Template vocabulary and defaults | `src/features/comms/template-keys.ts`, `templates.ts` |
| Merge-field resolution and preview | `src/features/comms/resolve-template.ts`, `template-preview.ts` |
| Bulk composition and audience | `src/features/comms/bulk-*.ts` |
| Reminder sweeps | `src/features/jobs/reminders.ts`, `task-reminders.ts` |
| Calendar invites | `src/features/comms/ics.ts` (unit tested) |
