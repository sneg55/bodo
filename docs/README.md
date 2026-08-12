# bodo documentation

Start with [Product overview](product-overview.md): who uses bodo, the five nouns the whole
product hangs off, and the lifecycle a submission moves through.

## Product

| Document | What it covers |
|---|---|
| [Product overview](product-overview.md) | Users, object model, submission lifecycle, what is deliberately out of scope |
| [Call for papers](features/call-for-papers.md) | The form builder, field types, conditional logic, track routing, the public submission page |
| [Speaker portal](features/speaker-portal.md) | Sign-in, profile, submissions, tasks, resources, and how ownership is enforced |
| [Review and scoring](features/review-and-scoring.md) | Rounds, criteria, weighted aggregation, assignment, staged decisions, notification |
| [Agenda and schedule](features/agenda-and-schedule.md) | The builder, the six views, conflict detection, auto-schedule, publishing, calendar invites |
| [Communications](features/communications.md) | Templates, merge fields, bulk send, the outbox and why it exists, `.ics` invites |
| [Tasks and files](features/tasks-and-files.md) | Onboarding tasks, file requests, uploads and their limits, versions, bulk download |
| [Speaker CRM](features/speaker-crm.md) | The cross-event directory, saved lists, pipeline, CSV import, merging duplicates |
| [Dashboards](features/dashboards.md) | Event home, onboarding status, custom dashboards and the widget catalogue |
| [Embeds and public pages](features/embeds-and-public-pages.md) | The public event site, the five embeddable views, the five formats |
| [AI features](features/ai.md) | Ask, pre-screen, dashboard proposal, and how all three behave with no API key |
| [Imports and integrations](features/imports-and-integrations.md) | Migrating in from Sessionboard, Sessionize or Accelevents; the one-way sync; outbound webhooks |

## Interfaces

| Document | What it covers |
|---|---|
| [API](api.md) | REST endpoints, tokens and their scope, the MCP server, webhook signing |

## Engineering

| Document | What it covers |
|---|---|
| [Architecture](architecture.md) | Stack, the two constraints that shape everything, caching, authorization, exactly-once, the Worker entrypoint |
| [Data model](data-model.md) | All 42 Airtable tables and the conventions behind them |
| [Operations](operations.md) | Environment, provisioning, seeding, deploying, cron schedules, watching a deployment |

## Context

| Document | What it covers |
|---|---|
| [Beyond the brief](beyond-the-brief.md) | The requirements baseline, and an accounting of everything built past it |
