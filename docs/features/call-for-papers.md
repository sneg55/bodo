# Call for papers

The intake half of the product: an organizer builds a form, publishes its URL, and proposals
arrive already routed to the right track with the right people attached.

## The form builder

`/admin/<event>/forms` lists the event's forms; opening one is the builder.

Fifteen field types, labelled as the reference product labels them (`select` renders as
"Dropdown", not "Select", because familiarity is part of what is being replaced):

Text, Wysiwyg, Email, Phone, Dropdown, Multi-Select, Radio, Checkbox, File, URL, Video,
Number, Date & Time, Biography, Headshot.

Four of those are more than an input:

- **Biography** and **Headshot** write through to the speaker's own record rather than into
  the submission's answers, so a speaker who fills them in during a CFP has already populated
  their portal profile.
- **File** uploads stream to R2 and are attached to the submission.
- **Video** collects a URL. bodo does not host video; a video application is a link.

Character caps are per type and shown as a chip on the builder row (255 for Text, 5000 for
Wysiwyg and Biography, 2048 for URL and Video), overridable per field. A **cross-field limit**
caps several fields together by total characters, optionally per participant, which is how
"1,500 characters across your bio and your abstract" is expressed.

### The field library

An event has a library of registry fields, configured at
`/admin/<event>/settings/fields`. A field dragged in from the library carries a
`registryKey`, and that key is the only thing allowed to decide where the answer is stored:
the registry says whether a key is a first-class Airtable column or an `answersJson` entry.

This matters more than it looks. A locally-added dropdown labelled "Format" is structurally
identical to the library's Format field, so inferring storage from the label, the type or the
lock state would write a local answer into a column belonging to a different question. The
builder warns when a locally-authored question impersonates a library field.

### Conditional logic

Any field can carry a `showIf` condition against an earlier field: `eq`, `neq`, `in`, or
`answered`. One dependency level, evaluated in the browser as the speaker types **and again
on the server** when the submission is written, because a hidden field's answer must not be
accepted just because the client sent it.

### Routing

A routing rule is a condition plus a track. Rules are evaluated in order with a default track
for the no-match case, so "Format = Workshop → Workshops track" lands the submission in the
right queue, in front of the right reviewers, without an organizer sorting it by hand.

Track answers resolve against the event's own track vocabulary, and the builder refuses to
publish a form whose options cannot be stored.

### Participants

A form declares which participant roles it accepts and how many of each: speaker,
co-speaker, moderator, and so on, each with an enabled flag and a min/max. The public wizard
enforces those counts, and accepting the submission is what turns those participants into
speaker records.

## The public submission page

Two entry points, both public and neither requiring an account:

- `/submit/<event-slug>` lists the event's open forms. This is the link to put on a website.
- `/submit/<event-slug>/<form-public-id>` is one form directly.

The public id is opaque and immutable rather than a slug, which is also what the reference
product does: an opaque id needs no collision policy, no rename handling and no reserved-word
list.

The wizard is multi-step, counts characters against the caps, shows and hides fields as
answers change, and saves a draft. A returning drafter is told the draft was restored and can
discard it. The draft is bound to a signed claim, so an anonymous drafter can finish their own
submission and nobody else can adopt it.

On submit: the submission is written, participants are created or matched, the track is
resolved, a confirmation email goes to the submitter and an alert to the configured admin
addresses. The speaker can then sign in at `/login` with the same address and see it in the
portal.

## Forms that are not CFP forms

The same builder serves **portal forms** (`kind: 'task'`), the questionnaires assigned to
accepted speakers: AV requirements, travel, a hotel form. They differ in who they are
addressed to and in that assigning one creates a task rather than a submission. See
[Tasks and files](tasks-and-files.md).

## Where the logic lives

| Concern | File |
|---|---|
| Field visibility evaluation | `src/features/forms/logic.ts` (unit tested) |
| Where an answer is stored | `src/features/forms/answer-storage.ts` |
| Character and cross-field limits | `src/features/forms/answer-length.ts`, `builder/checks-limits.ts` |
| Builder validation and warnings | `src/features/forms/problems.ts`, `builder/checks-registry.ts` |
| Public wizard state and gating | `src/features/submissions/wizard-*.ts` |
| Track resolution and repair | `src/features/submissions/track-precedence.ts`, `track-repair.ts` |
