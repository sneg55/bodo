# Review and scoring

Getting from a pile of proposals to a decision, with more than one person's opinion and a
record of how it was reached.

## Abstracts

`/admin/<event>/abstracts` is the working table: every submission, filterable by status,
track, form and round, with aggregate scores as a column. Status tabs carry counts. Columns
are pickable and orderable, the selection persists, and a filter set can be saved as a named
view and reopened later.

Opening a row is the detail page: the answers as submitted, the cast, the files, the review
history, and the scoring form for the current round.

Bulk actions operate on a selection: stage a decision, assign reviewers, send an email,
export to CSV.

## Rounds

Review is organized into rounds, configured at `/admin/<event>/evaluation/plan`. A round has
a name, a set of criteria, and the submissions and reviewers entered into it. A submission's
per-round status runs `pending → in_review → advanced | rejected`, which is separate from its
overall lifecycle status: advancing out of round 1 is not accepting the talk.

## Criteria

Three kinds:

- **numeric**: a score between a min and a max.
- **select**: named choices, each carrying the score it contributes. This is how
  `Accept = 1 / Maybe = 2 / Reject = 3` style rubrics are authored.
- **text**: a comment, excluded from the arithmetic.

Every criterion carries a weight. A reviewer also gives an overall recommendation
(`yes`, `no`, `maybe`) and can declare a conflict of interest, which recuses their review
from the aggregate without deleting it.

## How the aggregate is computed

`src/features/review/scoring.ts`, pure and unit tested:

1. Per review: a **weighted mean** of the criteria that were answered, normalized to a
   0-1 fraction so criteria with different ranges are comparable.
2. Across reviewers: the mean of those, with the **reviewer count carried alongside**.

The count is not decoration. It is the only thing stopping the table from ranking a
submission one reviewer liked above one three reviewers agreed on.

The function is total: no clock, no I/O, and it does not throw for any rubric a round can be
configured into, because it runs inside a cached read where an exception would take out the
whole Abstracts table. Stored scores outside a criterion's range are clamped rather than
rejected, so a rubric edited after reviews were written does not discard them.

## Assignment

Reviewers are assigned per round, individually or in bulk, and can be organized into teams.
A reviewer sees the rounds they are on and can score there; everywhere else they are
read-only, with the controls that would write disabled rather than hidden.

Reviewer progress (who has done how many of their assignments) is visible to the organizer,
and a reminder can be sent to the ones who are behind.

## Deciding

A decision is staged, not applied. Moving rows into **Accept Queue** or **Decline Queue**
changes nothing for the speaker; a separate **Notify** step commits the queue and queues the
mail in one action. That ordering is deliberate: it makes "decided but not yet told" a real
state an organizer can sit in, review, and change their mind about.

Notify shows what it is about to do before it does it, and a row already decided but never
notified is picked up on re-entry rather than skipped, which is what covers a status moved
straight to `accepted` outside the queue.

The mail is queued, not sent inline. It leaves on the next outbox drain. See
[Communications](communications.md).

Accepting also reconciles the submission's track and announces the change to webhooks and the
rest of the app. Assigning onboarding tasks to accepted speakers is a separate bulk action
rather than a side effect of the decision, so an organizer decides when the chasing starts.

## Session content

Separately from whether a talk was accepted, its **content** has a status of its own:
whether the abstract and slides have been read, sent back for changes, or approved. Organizers
can edit session content directly, with version history, so a title tidied for the programme
does not lose what the speaker wrote.

## AI pre-screen

A whole round can be pre-screened by Claude, producing reviews attributed to an AI reviewer
rather than silently mixed in with human ones. See [AI features](ai.md).

## Duplicate and near-duplicate detection

The detail page surfaces similar submissions in the same event, which is how the same talk
submitted twice under different titles gets noticed before both go to reviewers.

## Export

CSV export of the current filtered view, columns and all. XLSX is deliberately not built: it
needs a spreadsheet writer.

## Where the logic lives

| Concern | File |
|---|---|
| Weighted aggregation | `src/features/review/scoring.ts` (unit tested) |
| Round planning and criteria authoring | `src/features/review/plan-*.ts` |
| Queue staging and commit | `src/features/submissions/decisions.ts`, `commit-status.ts` |
| Legal status transitions | `src/constants/status.ts` |
| Notification audience and preview | `src/features/submissions/decision-*.ts` |
| Similarity | `src/features/review/similarity.ts` |
| CSV export | `src/features/review/abstracts-csv.ts` |
