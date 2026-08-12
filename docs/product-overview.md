# Product overview

bodo runs the speaker side of a conference: collecting talk proposals, reviewing them,
deciding, telling people, and turning the survivors into a published schedule. It is an
open-source replacement for [Sessionboard](https://www.sessionboard.com/), built for a team
that was paying more than $40k a year for a subset of it.

## Who uses it

| Role | What they do | Where they work |
|---|---|---|
| **Organizer** | Configures the event, builds the CFP form, runs review, decides, builds the agenda, chases speakers | `/admin` |
| **Reviewer** | Scores and comments on submissions in the rounds they are assigned to | `/admin`, read-only outside their rounds |
| **Speaker** | Submits a proposal, then maintains a bio, a headshot, slides and their tasks | `/portal` |
| **Public visitor** | Reads the published schedule and speaker list | `/agenda/<event>`, `/embed/<id>` |

Capability comes from an `EventMemberships` row, never from a role baked into the session
cookie, so a change of access takes effect on the next request rather than when a token
expires. A reviewer who can read a page cannot write to it, and the controls that would
write are disabled rather than absent, so the surface stays legible.

## The object model

Five nouns carry the product. Everything else hangs off them.

```
Event ──┬── Form ──────── Submission ──┬── SubmissionParticipant ── Speaker
        │                              │
        │                              ├── Review (per round, per reviewer)
        │                              └── Session (room + time, once accepted)
        │
        ├── Task ──────── TaskAssignment ── Speaker
        ├── FileRequest ─ FileRequestAssignment ── File
        └── Embed ─────── the public schedule and speaker views
```

A **submission** is the unit of work. It is created by a speaker through a public form or by
an organizer by hand, it accumulates reviews, it is decided, and on acceptance it becomes a
**session** that can be scheduled. A **speaker** is a person, and the same person can appear
across many events: the CRM is that view.

## The submission lifecycle

```
draft ──> pending ──┬──> accept_queue ──> accepted
                    └──> decline_queue ──> declined
                                     withdrawn (from anywhere)
```

The two queue states are the part people miss. A decision is **staged** rather than applied:
moving a row to Accept Queue changes nothing for the speaker. A separate **Notify** step
promotes the queue in bulk and queues the decision email with it, which is what makes
"decided but not yet told" a state an organizer can sit in, review, and change their mind
about. A row can still be moved straight to `accepted` without going through Notify, and
Notify picks up an accepted-but-unnotified row on re-entry rather than skipping it.

Post-decision moves back are legal and deliberately rare, because a mistaken accept has to be
recoverable without editing Airtable by hand.

Accepting reconciles the submission's track and announces the change to anything subscribed.
The speaker records already exist by then, created when the submission was made. Assigning
the event's onboarding tasks to accepted speakers is a separate, explicit bulk action, and
re-running it only adds what is missing.

Scheduling is **orthogonal** to review: an accepted talk is `unscheduled` until it has a room
and a time, then `scheduled`, and `published` is the separate act that exposes it to the
public pages and the API. Content status (has anyone read the slides yet?) is a third axis
again, because "accepted", "scheduled" and "the deck has been reviewed" are genuinely
different questions and an organizer needs all three.

## What each area does

| Area | Documentation |
|---|---|
| Building a CFP form, conditional logic, routing, the public submission page | [Call for papers](features/call-for-papers.md) |
| The speaker's own view: profile, submissions, tasks, requested files, resources | [Speaker portal](features/speaker-portal.md) |
| Rounds, criteria, assignments, aggregate scores, decisions, notification | [Review and scoring](features/review-and-scoring.md) |
| Scheduling, conflicts, the six views, publishing | [Agenda](features/agenda-and-schedule.md) |
| Templates, merge fields, bulk send, reminders, calendar invites | [Communications](features/communications.md) |
| Speaker tasks, file requests, deliverables, bulk download | [Tasks and files](features/tasks-and-files.md) |
| The cross-event speaker database, saved lists, import, pipeline | [Speaker CRM](features/speaker-crm.md) |
| Onboarding status, custom widgets, charts | [Dashboards](features/dashboards.md) |
| The public schedule, the speaker gallery, embeddable views, feeds | [Embeds and public pages](features/embeds-and-public-pages.md) |
| Ask, pre-screen, dashboard proposal, and how they behave without a key | [AI features](features/ai.md) |
| Migrating in from another platform, Accelevents sync | [Imports and integrations](features/imports-and-integrations.md) |
| REST API, MCP server, webhooks, tokens | [API](api.md) |

## What is deliberately not built

Named rather than left as silent gaps:

- **Payments, fees, invoices, exhibitors, sponsors, marketing.** Sessionboard's other half.
  bodo is speaker operations only.
- **XLSX import and export.** Both need a spreadsheet reader or writer. CSV covers the same
  ground for the paths that matter (speaker import, abstracts export).
- **Session import** from a file. Speaker import exists; the session equivalent is a
  different surface over a different table.
- **Multi-language.** English only, deliberately. `Submissions.language` is the language a
  talk is *delivered* in, which is metadata, not a UI locale.
- **Video hosting.** A video application is collected as a URL, not an upload.

Navigation entries for out-of-scope areas still render, because an organizer's muscle memory
is part of what is being replaced. Each lands on a page that says what it is rather than a
404.
