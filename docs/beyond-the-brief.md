# Beyond the brief

bodo was built to a requirements brief with nine features, later amended to add a tenth
(speaker CRM) and with a public API named as a bonus. This page is the honest accounting of
what exists beyond that: what nobody asked for, why it is here, and what it cost.

The distinction matters because "we built more" is only interesting if the baseline is
stated. It is:

| # | Asked for | Status |
|---|---|---|
| 1 | CFP submission forms with conditional logic and routing | Built |
| 2 | Self-service speaker portal | Built |
| 3 | Automated speaker communications, including calendar invites | Built |
| 4 | Submission review and scoring, multi-round (AI part "very optional") | Built, AI included |
| 5 | Agenda builder with conflict detection | Built |
| 6 | Onboarding tasks and a status dashboard | Built |
| 7 | Accelevents integration | Built, then withdrawn as a requirement. Kept |
| 8 | Portal resources and wiki pages | Built |
| 9 | Embeddable public gallery and schedule | Built |
| 10 | Public API (named as a bonus) | Built |
| 11 | Speaker CRM (added by an amendment) | Built |

Everything below is on top of that.

## Whole capabilities nobody asked for

### An MCP server

`POST /api/v1/mcp`, four read-only tools, over the same token as the REST API. See
[API](api.md).

The reasoning: requirement 6 is "an admin dashboard showing which speakers still have
outstanding tasks". The dashboard is built, and it is the right answer for the organizer at
their desk. But the question *"who still owes me a headshot"* gets asked in Slack, in a
terminal, in the middle of doing something else. The MCP server is that same requirement
delivered where a lot of this work now actually happens.

It is read-only on purpose. An agent that can accept a submission or email a speaker on its
own is not something anyone should point at a live conference the week of the event.

### Migration in from another platform

Requirement 7 was about pushing data *out*. Nothing asked how a conference already running on
Sessionboard, Sessionize or Accelevents would get its existing sessions and speakers *in*.

Without that, adopting bodo means retyping a programme. So there is an import engine with
three source adapters, a preview step, and a mapping ledger that makes a re-run safe. See
[Imports and integrations](features/imports-and-integrations.md).

The detail that shows it was designed rather than bolted on: the three sources are not
organized by API shape, they are organized by whether the source carries an email address,
because that is what decides whether the import ends with speakers who can be sent a magic
link or with a list somebody has to work through.

### Two more AI surfaces

The brief marked exactly one AI feature as "very optional": an AI-assisted review pass. That
is built (see [AI features](features/ai.md)). Two others are not in the brief at all:

- **Ask (⌘K)** answers questions about the event in prose and cites the rows behind each
  answer, with a resolver that drops any citation not present in the exact snapshot the model
  was shown. A hallucination can make an answer thinner; it cannot manufacture a link.
- **Dashboard from a description** proposes a dashboard from plain English, selecting from
  the widget catalogue rather than inventing metrics.

All three run canned by default, computed from the event's own data, so a clone with an empty
`.env` demonstrates them.

### Auto-schedule

Requirement 5 asks for drag and drop with conflict detection. Both are built. The first pass
of an agenda is still hours of dragging, so there is an auto-schedule run that places
unscheduled sessions into free room and time slots, respecting the same conflict rules, as a
starting grid the organizer then adjusts.

### Duplicate detection, twice

- **Similar submissions** are surfaced on the abstract detail page, which is how the same talk
  submitted twice under two titles gets noticed before it reaches two sets of reviewers.
- **Speaker merge** absorbs duplicate people records: the survivor keeps its id and gains the
  union of everyone's events, every link is repointed before anything is deleted, and cast rows
  collapse rather than doubling. The CRM requirement asked for duplicate detection *on import*;
  merging the ones already in the base is the other half.

### A demo mode

`DEMO_MODE=1` gives one-click sign-in as an organizer, a reviewer or a speaker. Magic-link
auth is the right design and it is a wall in front of anyone evaluating the product, who has
no mailbox on the seeded domain. Nobody asked for this. Anyone assessing the deployed site
needs it.

### Impersonation

An organizer can view the portal as a specific speaker, which is how a support question gets
answered without asking someone to screen-share. The grant is claimed exactly once through
the same Durable Object the magic links use, and the portal renders a banner saying whose
view it is.

## Depth inside the features that were asked for

These are not separate features. They are the parts of an asked-for feature that a first pass
would have skipped.

| Area | What was added | Why |
|---|---|---|
| Review | **Recusal.** A reviewer can declare a conflict of interest; the review is kept but excluded from the aggregate | The alternative is a reviewer quietly not scoring, which looks identical to being behind |
| Review | **Reviewer count carried with every average** | Otherwise the table ranks a submission one reviewer liked above one three reviewers agreed on |
| Review | **Staged decisions.** Accept Queue and Decline Queue, committed by a separate Notify step that queues the mail with them | Makes "decided but not yet told" a real state an organizer can sit in and change their mind about |
| Review | **Session content status and version history** | "Accepted" and "somebody has read the slides" are different questions, and an organizer tidying a title should not lose what the speaker wrote |
| Files | **Versions and comment threads** | A re-uploaded deck should not erase the one that was reviewed, and "can you fix slide 4" belongs on the file |
| Files | **Bulk download as a streamed archive** | A whole track's decks reaching an AV team is one action, not forty |
| Tasks | **Tasks addressed to a session, not only to a person** | "Upload your slides" means three different things to a speaker with three accepted talks |
| Portal | **Scoped to the person, across events** | A speaker at two of the organization's conferences sees both, rather than needing to know which portal URL is which |
| Comms | **A full email history**, per event and per person across events | "What have we already told this person" otherwise means searching somebody's sent folder |
| Comms | **Calendar subscription feed** from the portal | Invites are point-in-time; a subscription tracks the schedule |
| Tables | **Saved views**: a named, shareable filter set on the Abstracts table and the agenda session list | An organizer runs the same three queries every day of the CFP |
| Events | **Branding**: logo, background, theme colour per event | The public pages are the event's, not bodo's |
| Access | **Team management**: invite organizers and reviewers, manage roles | Requirement 4 implies multiple reviewers and never says how they arrive |
| UI | **Light and dark, following the machine** | Colours come from theme tokens, so both work everywhere rather than one being an afterthought |

## Engineering guarantees the brief never mentioned

The brief's only non-functional requirement was speed ("we do not want slow SaaS pls"). These
are the things that were built because the product is a queue-driven system on a store with no
transactions, and doing it any other way produces bugs that are invisible until they are
expensive.

- **One lock, everywhere something must not run twice.** Magic-link consumption, outbox
  sends, webhook deliveries, AI pre-screen jobs, Accelevents pushes, import runs, CRM
  imports, impersonation grants and file bundles all go through the same Durable Object
  compare-and-swap, because Airtable has neither a transaction nor a CAS and KV is eventually
  consistent. Each is paired with an expiring lease, so a crashed worker's row becomes
  claimable again, and with the thing that makes the resulting retry safe: a provider
  idempotency key, a mapping ledger, or a delivery id the receiver can deduplicate on.
- **Snapshot at enqueue, endpoint at send.** A webhook retried three hours later carries what
  happened, and is signed with the secret the receiver is verifying with today.
- **One definition of public.** The public pages, the embeds, the feeds and the REST API all
  read the same published-agenda projection, so an unpublished session cannot leak through a
  second door.
- **A central error registry.** Every failure the code raises deliberately carries an id, so
  an API client can branch on it and a message can be rewritten without breaking anyone.
- **Granular cache tags.** Accepting one submission does not invalidate the agenda and every
  list. Over-invalidation is treated as a defect.
- **Over 5,000 unit tests**, concentrated on the rules that fail silently: conflict detection,
  score aggregation, conditional visibility, `.ics` sequence and folding, claim semantics, and
  every queue's selection policy.
- **Lint that enforces the architecture.** A hand-rolled button or input, a `fixed inset-0`
  overlay, a hand-written `role="menu"`, a direct `@radix-ui/*` import, or the Airtable or
  Anthropic SDK imported outside its boundary is an error with a message naming the
  replacement, not a review comment somebody has to remember to make.

## What was deliberately not built

Listed in [Product overview](product-overview.md#what-is-deliberately-not-built), and worth
repeating here because a list of extras with no corresponding list of omissions is marketing
rather than an accounting: payments and fees, exhibitors and sponsors, invoices, marketing,
XLSX in either direction, session import from a file, multi-language, and video hosting.
