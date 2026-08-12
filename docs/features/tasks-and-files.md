# Tasks and files

Speaker onboarding: the checklist an organizer defines, the things they need back, and where
those things end up.

## Tasks

`/admin/<event>/tasks` defines the checklist and shows who has done what.

A task is addressed to one of three kinds of thing, and the distinction is not cosmetic:

| Entity type | Addressed to | Example |
|---|---|---|
| **contact** | The person | "Complete your bio and profile" |
| **submission** | One accepted talk | "Upload your slides", once per session |
| **group** | A cohort | Something asked of a subset |

A speaker with three accepted talks gets three copies of a submission task and one copy of a
contact task, which is the difference between "upload your slides" meaning one thing and
meaning three.

Assignment is a bulk action: assign to accepted speakers, and the fan-out creates one
assignment per target with deduplication, so re-running it after a new acceptance adds only
what is missing.

### Task kinds

- **Manual**: a description and a Done button.
- **Form**: a portal form, authored in the same builder as the CFP forms. Answers are stored
  on the assignment. `/admin/<event>/portal-forms`.
- **Upload**: satisfied by a file. See below.

## File requests

`/admin/<event>/file-requests` is the same idea for deliverables: "Upload your final headshot
(print quality)", "Send your session presentation". A request carries instructions, a due
date, a required flag, and a counter showing how many of the people it was sent to have
delivered.

The counter is the point. It is the only place an organizer can see whether a request they
created ever reached anybody.

## Uploads

Files stream to R2 from the browser. Nothing is buffered in a Worker.

Every upload is validated **before the first byte is written**: type and size are checked
against a per-kind limit.

| Kind | Cap | Accepted types |
|---|---|---|
| `headshot`, `image`, `event-background` | 10 MB | Images |
| `event-logo` | 5 MB | Images |
| `slides` | 25 MB | PDF, PowerPoint, Keynote |
| `doc` | 25 MB | PDF, Word, and the document types |

A photo delivered against a file request is an `image`, not a `headshot`, and that
distinction is load-bearing: a headshot is public and its URL is written onto the speaker's
record, so a print-quality photo answering a request must not silently replace somebody's
profile picture, and a photo of a demo rig certainly must not.

Files carry a visibility, and private files are served through an authorizing route rather
than by an unguessable URL.

## Files and deliverables

`/admin/<event>/files` is every file in the event, filterable, with the speaker and the
session it belongs to. `/admin/<event>/portal-files` is the portal-facing view of the same
material.

Files have **versions**: a re-upload against the same request keeps the history rather than
overwriting it. Files have **comment threads**, so a reviewer can ask for a change on the
deck itself instead of by email.

## Bulk download

A selection of files can be downloaded as a single archive, streamed out of R2 rather than
assembled in memory. This needed an archive writer, which is at `src/utils/zip.ts`.

A bundle can also be produced as a link and mailed, which is how a whole track's decks reach
an AV team.

## Reminders

Outstanding tasks feed the automated reminder sweep, so that chasing is a schedule rather
than a person's job. Chasing an undelivered file request is a button instead, because a
deliverable is usually one conversation rather than a standing nudge. See
[Communications](communications.md).

## Where the logic lives

| Concern | File |
|---|---|
| Assignment fan-out and dedupe | `src/features/assignments/fanout.ts`, `dedupe.ts` |
| Task planning and progress | `src/features/tasks/plan.ts`, `progress.ts` |
| File request delivery and receipts | `src/features/file-requests/delivery.ts`, `receipt.ts` |
| Upload validation | `src/services/storage/upload-limits.ts` |
| Archive writer | `src/utils/zip.ts`, `src/utils/zip-records.ts` |
| Versions and comments | `src/features/files/versions.ts`, `comment-threads.ts` |
