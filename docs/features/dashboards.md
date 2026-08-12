# Dashboards

Where an organizer looks first: what needs attention, and how the event is tracking.

## Event home

`/admin/<event>` is the built-in **Today** view. It is not configurable and does not need to
be: submissions arriving, review progress, agenda readiness, what is overdue, and the lists an
organizer opens most.

## Onboarding status

The per-speaker onboarding board lives with the work it describes, on
`/admin/<event>/tasks`, under the task definitions. It shows every accepted speaker, how far
through their checklist they are, and exactly what each of them still owes.

It refreshes on its own. A visibility-aware poller updates it while the tab is in front of
you and stops when it is not, so "a speaker completed one task" appears without a manual
reload, without a socket, and without polling a tab nobody is looking at.

## Custom dashboards

Beyond Today, an organizer can create dashboards of their own, each a named tab with a colour
dot, holding widgets they choose.

Eight widget metrics ship:

| Widget | Type | What it counts |
|---|---|---|
| Accepted Speakers | stat | Distinct people on an accepted submission |
| Outstanding Speaker Tasks | stat | Portal tasks assigned and not yet done |
| Total Submissions | stat | Every submission on the event, drafts included |
| Pending Review | stat | Submissions still awaiting a decision |
| Speaker Confirmation Mix | donut | Confirmation tasks done, over everyone sent one |
| Submissions by Form | chart | Which form they came through |
| Submissions by Track | chart | Distribution across the programme |
| Top Speakers by Outstanding Tasks | top list | Who to chase first |

Widgets can be added from a gallery, reordered, and removed. Each card says what its number
actually counts, because several of these words mean more than one thing in an event: the
confirmation mix is *portal confirmation tasks*, not the roster's speaker status and not a
session being accepted.

Charts are drawn from the event's own data with no chart library at the layout level; the
heavier rendering is imported at the component that needs it.

## Building a dashboard from a description

A dashboard can be proposed from a plain-English description ("show me what is blocking the
programme this week"). The proposal is a set of widgets from the catalogue above, which the
organizer then keeps or edits. It cannot invent a metric that does not exist.

Like every AI surface here, it runs from canned output by default so a clone with no key can
demonstrate it. See [AI features](ai.md).

## Where the logic lives

| Concern | File |
|---|---|
| Widget catalogue and metric definitions | `src/features/dashboard/widget-catalog.ts` |
| Metric computation | `src/features/dashboard/dashboard-reads.ts`, `status-mix.ts`, `pacing.ts` |
| Tabs, ordering and slugs | `src/features/dashboard/dashboard-tabs.ts`, `widget-order.ts` |
| Today's attention lists | `src/features/dashboard/attention.ts`, `home-view.ts` |
| Proposal from a description | `src/features/dashboard/ai-proposal.ts` |
