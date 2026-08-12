// Home: the Tasks card (ref 17), and the body of /portal/tasks.
//
// The Suspense boundary is INSIDE the card rather than around it, and that is the whole
// point: the card, its coloured header and its title need no data, so they flush first and
// the page shows its finished layout while only the rows stream in. A boundary drawn
// around the card would hold the header back with them and send a grey box instead.

import { BriefcaseIcon } from 'lucide-react'
import { Suspense } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { PortalCard } from '@/features/portal/PortalCard'
import type { PortalTaskItem } from '@/features/portal/ports'
import { readOwnSubmissions, readOwnTasks } from '@/features/portal/reads'
import { TasksPanel } from '@/features/portal/TasksPanel'
import { toTaskViews } from '@/features/portal/task-view'
import { getEvent } from '@/services/airtable/queries'

export function TasksCard() {
  return (
    <PortalCard icon={BriefcaseIcon} title="Tasks">
      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        <TasksBody />
      </Suspense>
    </PortalCard>
  )
}

/**
 * Every task the speaker owes, across every event they are on.
 *
 * `readOwnTasks` has spanned events since the portal went multi-event; the forms and the
 * timezone read here did not, and both were read for the ONE configured event. So a task on
 * any other conference was rendered against a form list that could not contain its form and
 * a timezone belonging to somewhere else, which is a due date off by a day at the edges.
 *
 * `readOwnSubmissions` already carries the forms for the whole scope (see its `forms` note),
 * so nothing extra is fetched for them. The dates are formatted per event, one group per
 * event that actually has a task, because `toTaskViews` formats against one zone: grouping
 * is what lets each conference's deadline read the way that conference states it, without
 * changing a mapper five other surfaces share. The order is unchanged, since `readOwnTasks`
 * already returns its items grouped by event.
 */
export async function TasksBody() {
  const [{ items, files }, { submissions, forms }] = await Promise.all([
    readOwnTasks(),
    readOwnSubmissions(),
  ])

  const groups = await Promise.all(
    [...groupByEvent(items)].map(async ([eventId, group]) => ({
      group,
      timeZone: (await getEvent(eventId)).timezone,
    })),
  )

  const tasks = groups.flatMap(({ group, timeZone }) =>
    toTaskViews({ items: group, submissions, forms, timeZone, files }),
  )

  return <TasksPanel tasks={tasks} />
}

/** Insertion-ordered, so the rendered order is the order `readOwnTasks` returned. */
function groupByEvent(
  items: readonly PortalTaskItem[],
): ReadonlyMap<string, readonly PortalTaskItem[]> {
  const groups = new Map<string, PortalTaskItem[]>()
  for (const item of items) {
    const held = groups.get(item.task.eventId)
    if (held === undefined) groups.set(item.task.eventId, [item])
    else held.push(item)
  }
  return groups
}
