# Data model

Airtable is the source of truth. 42 tables, 345 fields, defined as data in
`src/migrations/` and provisioned by `npm run airtable:schema`.

Airtable's own field names never leave `src/services/airtable`. Records are mapped to app
types at that boundary, with validation, so a column renamed in Airtable breaks one mapper
rather than the application.

## The tables

### Core

| Table | Fields | What it holds |
|---|---|---|
| `Events` | 17 | The conference: dates, timezone, branding, slug |
| `Forms` | 31 | A CFP or portal form: fields, logic, routing, roles, all as JSON |
| `Submissions` | 29 | The proposal, and later the session: status, schedule, content |
| `SubmissionParticipants` | 5 | The cast: who is on a submission and in what role |
| `Speakers` | 18 | A person, across events |
| `Rooms` | 4 | Where a session happens |
| `Tracks` | 4 | The programme's categories |
| `Tags` | 3 | Free-form labels |

`Submissions` carries the schedule (`startsAt`, `endsAt`, room) rather than a separate
Sessions table: a session *is* an accepted submission that acquired a time and a place, and
splitting them would mean keeping two rows in step for no gain.

### Access

| Table | Fields | What it holds |
|---|---|---|
| `AdminUsers` | 2 | An organizer or reviewer identity |
| `EventMemberships` | 4 | Who can do what, on which event. The only source of capability |

### Review

| Table | Fields | What it holds |
|---|---|---|
| `EvaluationPlans` | 4 | The event's review setup |
| `Rounds` | 10 | A round: its criteria, its window |
| `ReviewTeams` | 3 | A named group of reviewers |
| `ReviewTeamMembers` | 3 | Membership of one |
| `SubmissionRounds` | 5 | A submission's status within a round |
| `ReviewAssignments` | 6 | Who was asked to review what |
| `Reviews` | 9 | Scores, comments, recommendation, recusal |
| `AiPrescreenJobs` | 10 | The pre-screen queue |
| `SavedViews` | 8 | A named filter set over a table |

### Portal and deliverables

| Table | Fields | What it holds |
|---|---|---|
| `Tasks` | 9 | A task definition |
| `TaskAssignments` | 6 | One task, for one speaker, with its answers |
| `FileRequests` | 7 | A deliverable an organizer asked for |
| `FileRequestAssignments` | 5 | One request, for one speaker |
| `Files` | 11 | An uploaded object: kind, visibility, size, version |
| `FileComments` | 5 | A thread on a file |
| `PortalItems` | 8 | The portal's configured contents |
| `Resources` | 7 | A handbook page |

### Communications

| Table | Fields | What it holds |
|---|---|---|
| `EmailTemplates` | 5 | Subject and markdown body, per key |
| `EmailOutbox` | 18 | The queue: payload, status, lease, attempts, provider result |

### Integrations

| Table | Fields | What it holds |
|---|---|---|
| `IntegrationMappings` | 6 | Local record ↔ remote id, which makes a redo safe |
| `SyncLog` | 9 | Every push attempt, with the snapshot it sent |
| `Webhooks` | 8 | A subscription: URL, secret, event types |
| `WebhookDeliveries` | 13 | The delivery queue |
| `ApiTokens` | 7 | A SHA-256 digest, never the token |

### Content and presentation

| Table | Fields | What it holds |
|---|---|---|
| `ContentRevisions` | 7 | Version history for session content |
| `CmsEmbeds` | 12 | An embed's saved configuration |
| `Dashboards` | 6 | A named dashboard tab |
| `DashboardWidgets` | 5 | A widget on one |

### CRM

| Table | Fields | What it holds |
|---|---|---|
| `SpeakerTags` | 3 | A tag and its members |
| `SpeakerLists` | 4 | A saved, shareable filter set |
| `SpeakerNotes` | 4 | Append-only notes about a person |
| `SpeakerStageHistory` | 5 | Append-only pipeline movements |

## Conventions

**JSON columns where the shape is ours.** A form's fields, its routing and its role rules are
JSON on the `Forms` row rather than child tables, because the shape belongs to the builder and
a parallel table would need converting at every boundary. Answers that do not map to a
first-class column live in `answersJson` on the submission.

**Append-only where the record is the point.** Notes, stage history, content revisions and
file comments are never rewritten: a note an organizer can quietly edit is not a record of
what was decided.

**Links, not copies.** A delivery links to its subscription rather than copying the URL and
secret, so a rotated secret applies to a retry. One consequence to know about: Airtable
*clears* a link cell when the linked record is deleted, so anything reading a link as
required has to cope with an orphan.

**The lifecycle vocabularies are declared once**, in `src/constants/status.ts`: submission
status and its legal transitions, schedule status, content status, participant roles, task
entity types, review recommendations, outbox statuses and speaker stages. Every filter, chip
and query reads them from there, so a typo is a type error rather than a row that silently
never matches. Smaller vocabularies live next to the type they belong to.

## Provisioning

```bash
npm run airtable:schema:plan   # what would be created; no writes
npm run airtable:schema        # idempotent: a second run creates nothing
npm run airtable:seed          # a demo event with submissions, speakers, rooms, tracks
```

Airtable's Meta API refuses to create computed field types, so the schema does not model
them: nothing here is a formula, rollup, count or lookup. The one declared field the API
still will not create is `autoNumber`, and the script reports it as manual work rather than
failing the run.

The token needs `schema.bases:read`, `schema.bases:write`, `data.records:read` and
`data.records:write`, **and** the base has to be added under the token's separate **Access**
panel. Scopes alone grant access to zero bases.
