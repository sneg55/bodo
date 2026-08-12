// The reads behind the snapshot.
//
// Four tagged `fetch` reads, run together. Every one of them is already cached and
// already tagged by `read-cache.ts`, so the snapshot costs nothing that the Abstracts
// list and the agenda have not already paid for, and a write that invalidates a tag
// invalidates the snapshot's view of it too. There is no separate AI cache to go stale.

import { buildEventSnapshot, type EventSnapshot } from '@/features/ai/snapshot'
import {
  getEvent,
  listRooms,
  listSpeakers,
  listSubmissions,
  listTracks,
} from '@/services/airtable/queries'

export async function loadEventSnapshot(eventId: string): Promise<EventSnapshot> {
  const [event, tracks, rooms, submissions, speakers] = await Promise.all([
    getEvent(eventId),
    listTracks(eventId),
    listRooms(eventId),
    listSubmissions(eventId),
    listSpeakers(eventId),
  ])

  return buildEventSnapshot({ event, tracks, rooms, submissions, speakers })
}
