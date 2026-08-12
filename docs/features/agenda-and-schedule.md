# Agenda and schedule

Turning accepted talks into a programme, catching the collisions, and publishing it.

## The builder

`/admin/<event>/agenda`. Accepted-but-unscheduled sessions sit in a tray; the grid is rooms
against time. Dragging a session onto the grid schedules it, dragging it again moves it. Edits
apply optimistically and reconcile against the server, so the board does not stutter on a
network round trip.

Six views over the same data:

| View | What it is for |
|---|---|
| **List** | The table. Sort, filter, edit inline, export |
| **Day** | One day, rooms across |
| **Week** | The whole conference at a glance |
| **Month** | Multi-week events and pre-conference days |
| **Rooms** | Room-first, which is how venue conversations happen |
| **Conflicts** | Only what is wrong |

## Conflict detection

Two kinds, computed on every change:

- **Room**: two sessions overlapping in the same room.
- **Participant**: one person in two places at once.

Two properties drive the implementation, and both are deliberate:

**It reports, it never blocks.** During agenda building a temporary double-booking is a
normal intermediate state, so a conflict is a badge and a row in the Conflicts view, not a
refused drag. Every function in `conflicts.ts` is pure and total: no throwing, no I/O, no
clock, and a malformed row is dropped from consideration rather than failing the pass.

**"Participant" means every row in `SubmissionParticipants`, not the submitter.** A
co-presenter on two accepted sessions is the case that actually bites at a conference, and a
submitter-only check misses it entirely.

A resolve dialog offers the fixes for a given conflict rather than leaving the organizer to
work out which of the two sessions to move.

## Auto-schedule

For the first pass, an auto-schedule run places unscheduled sessions into free room and time
slots, respecting the conflicts above. It proposes; the organizer keeps or adjusts. This is a
starting point for a grid, not a solver that claims to know the programme.

## Publishing

Scheduling and publishing are separate acts. A session with a room and a time is `scheduled`;
`published` is what exposes it to the public pages, the embeds and the API. Nothing public
reads anything else, which is what makes it safe to build a draft grid in the open.

Publishing announces: the speakers on newly published sessions can be sent their calendar
invites, and a `session.published` webhook fires for anything subscribed.

## The public site

`/agenda/<event-slug>` and four more pages under it: `/sessions`, `/schedule`, `/speakers`,
`/gallery`. Mobile-friendly, no login, and served from published rows only.

The same data is available as embeddable views and as machine-readable feeds. See
[Embeds and public pages](embeds-and-public-pages.md).

## Calendar invites

A scheduled session produces a standards-compliant `.ics` invite, which is the form the major
calendar clients consume as a real event. The hard part is that the room is assigned *after*
the first invite goes out, so invites must be updatable: `src/features/comms/ics.ts` keeps the
UID stable across sends, bumps `SEQUENCE` on change, supports cancellation, and handles
escaping and line folding. It is unit tested on all four.

Speakers can also subscribe to a calendar feed from the portal, so their own calendar tracks
the schedule without a re-send.

## Where the logic lives

| Concern | File |
|---|---|
| Room and participant overlap | `src/features/agenda/conflicts.ts` (unit tested) |
| Grid geometry and drag model | `src/features/agenda/timeline/` |
| Optimistic scheduling writes | `src/features/agenda/optimistic.ts`, `schedule-write.ts` |
| Auto-schedule | `src/features/agenda/auto-schedule.ts` |
| Publication state and announcement | `src/features/agenda/AgendaPublicationState.tsx`, `announce-published.ts` |
| Public projection | `src/features/agenda/public-agenda.ts`, `public-schedule.ts` |
| Calendar invites | `src/features/comms/ics.ts` (unit tested), `src/features/agenda/calendar-invites.ts` |
