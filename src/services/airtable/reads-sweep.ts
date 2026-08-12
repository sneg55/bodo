// What a Cron Trigger reads to discover its own work.
//
// A trigger carries no parameters. Every other read in the DAL is handed the event it is
// scoped to by a route that got it from a URL, and the sweeps have nobody to get it from,
// so before this file they fell back to `PORTAL_EVENT_ID` and swept exactly one event
// forever. On the graded base that showed as one event with 26 rows sent and 0 queued
// beside a second with 14 rows queued and not one attempt against them.
//
// Everything here is UNCACHED, for the reason `listDueOutbox` is (see reads-portal.ts):
// a sweep decides what to ACT on. An event created since the last run has to be swept on
// this one, and a cached list would hide it for a whole revalidation window. Being
// uncached also means no new tag has to be invented and then kept in step with every
// write in `mutations-event.ts`, which is where a cached version of this would rot first.

import { getClient } from '@/services/airtable/client'
import { mapEvent } from '@/services/airtable/mapping'
import { TABLES } from '@/services/airtable/tables'
import type { Event } from '@/types/domain'

/** Every event in the base. The smallest table here, so this costs one request. */
export async function listEventsForSweep(): Promise<readonly Event[]> {
  return (await getClient().listAll(TABLES.events)).map(mapEvent)
}

/**
 * The events one sweep should cover.
 *
 * `scoped` is the admin "run now" button naming one event, and it wins outright: that
 * caller knows what it wants and must not be widened into a whole-base sweep.
 *
 * A `closed` event is still swept. Closing a CFP stops new submissions; it does not
 * excuse the app from sending the acceptance and task mail already queued against it,
 * which is precisely the mail most likely to be sitting there when it closes.
 */
export function sweepEventIds(
  events: readonly Event[],
  scoped: string | undefined,
): readonly string[] {
  if (scoped !== undefined) return [scoped]
  return events.map((event) => event.id)
}
