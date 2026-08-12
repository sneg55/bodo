// The Tasks table itself, which nothing read before.
//
// `listTaskAssignmentsForEvent` reads Tasks too, but only to resolve the task behind an
// assignment, so a task nobody is assigned yet is invisible through it. The admin Tasks
// list is exactly the surface that has to show those: an organizer defines a task first and
// assigns it second.
//
// Its own file rather than an addition to reads-portal.ts, which is already at the file
// size limit.
//
// TAG CHOICE, and it is not a free one. This issues `GET /Tasks` with no filter and no
// sort, which is byte-for-byte the request `loadTaskGraph` already makes, and a Data Cache
// entry is keyed on the request (BUILD_SPEC 6.1). So the two reads SHARE one cache entry,
// and its tags are whichever request populated it. A private `event:{id}:task-defs` tag
// here would therefore be expired without expiring the entry the graph read populated, and
// a newly created task would keep not appearing until the window lapsed. Both reads name
// `event:{id}:tasks`, which is the tag every task write already expires.

import { mapTask } from '@/services/airtable/mapping-portal'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { listByEvent } from '@/services/airtable/reads'
import { TABLES } from '@/services/airtable/tables'
import { eventTasksTag } from '@/services/airtable/tags'
import type { Task } from '@/types/domain'

/** Every task defined on one event, assigned or not. */
export async function listTasksForEvent(eventId: string): Promise<readonly Task[]> {
  return await listByEvent(TABLES.tasks, eventId, mapTask, {
    cache: { tags: [eventTasksTag(eventId)], revalidate: REVALIDATE.edited },
  })
}
