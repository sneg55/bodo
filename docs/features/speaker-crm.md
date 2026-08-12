# Speaker CRM

The speaker database that spans events. An event's Speakers page answers "who is coming to
this conference"; the CRM answers "who have we ever approached, anywhere, and where did that
get to".

Lives at `/admin/crm`, outside any one event, and every read is scoped to the events the
viewer holds a membership on.

## Directory

`/admin/crm` is the searchable, filterable table of every contact in scope. Columns are
pickable and the filter set is expressive: by event, by stage, by tag, by whether they have a
bio or a headshot, by what they have submitted.

A filter set can be saved as a **named list**, which then appears in the sidebar and can be
shared with the team, updated and deleted. That is the "dynamic lists" capability: a saved
query, not a static membership snapshot, so a list called "Confirmed keynotes 2027" is
correct the day after somebody confirms.

## Contact profile

`/admin/crm/<speaker>` is one person across everything:

- Their events, and their status on each.
- Their sessions, across those events.
- The mail already sent to them, everywhere, which is otherwise a search of somebody's sent
  folder.
- Notes, append-only, because a note an organizer can quietly rewrite is not a record of what
  was decided. Notes follow the person rather than an event.
- Stage history, also append-only.
- Tags, from an event-independent vocabulary.

## Pipeline

`/admin/crm/pipeline` is the sourcing board: one column per stage, cards dragged between
them.

```
Prospect → Invited → Confirmed → Declined | Cancelled
```

The column an organizer drags a card out of is the same `Speakers.status` field the event
roster's tab strip filters on. What differs is the scope: the roster shows one event, the
pipeline shows everything the viewer can see. Moving a card writes a stage-history row.

## Import

`/admin/crm/import` takes a CSV, maps its columns to fields, detects duplicates against
existing records on a normalized email, validates per row, and reports the rows it refused as
a file you can download, fix and re-upload.

XLSX is deliberately not accepted; it needs a spreadsheet reader. There is no
"generate template" step because the mapping accepts whatever headers the file already
carries.

## Merging duplicates

Two records for one person is the normal state of any speaker database. Merge picks a
survivor and absorbs the others:

- The survivor is an **existing record**, not a new one written from merged fields, so its id
  survives and every link already pointing at it stays valid.
- It gains the union of everybody's event links, computed from the rows themselves rather
  than from the viewer's scoped roster, so a merge cannot silently unlink the survivor from an
  event this organizer cannot see.
- Every link to an absorbed record is repointed first, and the delete happens last. There is
  no transaction in Airtable, so the ordering is what bounds the failure: a merge that fails
  partway leaves both records present and is completed by running it again.
- Cast rows collapse rather than duplicate: if both records presented the same session, the
  result is one participant row, and a primary-presenter flag carries over.

## Dashboard

`/admin/crm/dashboard` summarizes the directory: stage mix, tag distribution, recent
activity.

## Bulk actions

Everything selectable in the directory can be emailed, tagged, enrolled into an event, or
added to a list.

## Where the logic lives

| Concern | File |
|---|---|
| Scope intersection | `src/features/crm/scope.ts` |
| Directory query and filters | `src/features/crm/directory-query.ts` |
| Saved lists | `src/features/crm/lists.ts` |
| Pipeline grouping and move rules | `src/features/crm/pipeline.ts` |
| Merge planning | `src/features/crm/merge.ts`, `src/services/airtable/mutations-crm-merge.ts` |
| CSV import, mapping and validation | `src/features/crm/import/`, `src/features/speakers/csv-import.ts` |
| Cross-event timeline | `src/features/crm/timeline.ts`, `profile-activity.ts` |
