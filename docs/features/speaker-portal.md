# Speaker portal

Everything a speaker can do without emailing an organizer. Five pages at `/portal`, scoped to
the person signed in.

## Signing in

There are no passwords anywhere in bodo. `/login` takes an email address and mails back a
single-use link. Consuming that link is guarded by a Durable Object compare-and-swap, so a
link forwarded, prefetched by a mail client, or clicked twice is accepted exactly once.

A speaker record is created by their first submission, so the address they submitted with is
the address that works.

## Home

`/portal` opens on three cards: their submissions with status, their profile at a glance, and
their outstanding tasks. The portal is scoped to the **person**, not to one configured event,
so a speaker appearing at two of the organization's conferences sees both here rather than
having to know which portal URL belongs to which event.

## Profile

`/portal/profile` is bio, headshot, and the contact and social fields the event asks for. The
bio is a rich-text editor; the headshot is posted to an upload route that streams it into R2
rather than buffering it. Both write to the speaker's own record, so a bio entered here is
the bio the public speaker page shows and the bio the organizer sees on the abstract.

## Submissions

`/portal/submissions` lists every submission the speaker is a participant on, across events,
with its status. Opening one shows the answers as submitted, the files attached to it, and
the cast: who else is on the talk and in what role (speaker, co-speaker, moderator,
chairperson).

Speakers may edit the body of a submission while it is `draft` or `pending`, and while the
form it came through still accepts updates. After a decision the answers become read-only,
but the deliverables around it do not: slides, headshots and task answers stay editable,
because an accepted talk is where most of the work starts. The organizers were explicit that
a blanket edit lock after acceptance is unwanted.

A speaker can also manage the roster on their own submission, within rules: they cannot
remove themselves into a talk with no speaker, and they cannot promote themselves over a
primary presenter who is somebody else.

## Tasks

`/portal/tasks` is the checklist. Tasks arrive by being assigned to accepted speakers, in
three kinds:

- **Manual**: a description and a Done button. "Confirm participation."
- **Form**: a portal form to fill in. Answers are stored against the assignment.
- **Upload**: a file the organizer asked for. See [Tasks and files](tasks-and-files.md).

Tasks group by what they belong to: a task addressed to the person, and a task addressed to
one of their sessions, are shown separately, because "upload your slides" means a different
thing for each of three accepted talks. A completed upload task shows the file it received,
with a download link, so a speaker can check what they actually sent.

## Resources

`/portal/resources` is the speaker handbook: pages an organizer writes in the admin, with
rich text and HTML embeds, for venue information, AV guidance, travel policy. Pages are
addressed by slug and can be linked to directly.

## Calendar

Once a talk is scheduled, the portal offers a calendar subscription so the speaker's own
calendar tracks the schedule, in addition to the `.ics` invites that arrive by email. See
[Communications](communications.md).

## Notes on scope and safety

- **Ownership is checked on the mutation, not only in the layout.** A layout is not a
  security boundary: a Next app has several entry points and a layout does not revalidate on
  every navigation. Every portal write re-verifies that the record belongs to the caller.
- **Organizers can view the portal as a speaker** from the admin, which is how a support
  question gets answered. The impersonation grant is claimed exactly once through the same
  Durable Object the magic links use, and the portal renders a banner saying whose view it is.
- **File access is authorized per request.** A portal file is served through
  `/api/portal/files/<id>` after an ownership check rather than by an unguessable URL.
