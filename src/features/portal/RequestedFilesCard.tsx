// Portal home: the Requested Files card, and the speaker half of R6's file requests.
//
// AUTHORED, not transcribed. Refs 17-18 capture the portal home with three cards (My
// Submissions, My Profile, Tasks) on an event that had no file requests, and there is no
// screenshot of a speaker-facing file request surface anywhere in the set. So this is the
// smallest thing consistent with what IS captured: a fourth `PortalCard` in the same frame as
// the other three, below Tasks, rendering only what an organizer has actually asked this
// speaker for. A speaker with nothing requested sees the card's empty line and nothing else.
//
// It is a card rather than a sixth pill in the portal nav deliberately. The nav lives in
// `src/components/shell/PortalChrome.tsx`, its five pills are the four captured ones plus the
// documented Resources addition, and adding another would be a second authored change to a
// captured control for a surface that fits inside a card.
//
// The Suspense boundary is INSIDE the card, as `TasksCard` explains: the coloured header needs
// no data, so it flushes with the page and only the rows stream.

import { FileUpIcon } from 'lucide-react'
import { Suspense } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { toRequestUploadViews } from '@/features/file-requests/portal-view'
import { PortalCard } from '@/features/portal/PortalCard'
import { RequestedFilesPanel } from '@/features/portal/RequestedFilesPanel'
import { readOwnRequestedFiles, readOwnSubmissions } from '@/features/portal/reads'
import { getEvent } from '@/services/airtable/queries'
import type { FileRequestItem } from '@/services/airtable/reads-requests'

export function RequestedFilesCard() {
  return (
    <PortalCard icon={FileUpIcon} title="Requested Files">
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <RequestedFilesBody />
      </Suspense>
    </PortalCard>
  )
}

/**
 * What every organizer has asked this speaker for, across every event they are on.
 *
 * `readOwnRequestedFiles` has spanned events since the portal went multi-event; the timezone
 * read here did not, so a document owed to the speaker's second conference had its due date
 * formatted in the configured event's zone, which is a deadline off by a day at the edges.
 * Grouped per event for the same reason `TasksBody` next door groups: `toRequestUploadViews`
 * formats against ONE zone, and grouping gets each conference's date right without changing
 * a mapper the organizer's side shares. Order is unchanged, since the read already returns
 * its items event by event.
 */
export async function RequestedFilesBody() {
  const [{ items, files }, { submissions }] = await Promise.all([
    readOwnRequestedFiles(),
    readOwnSubmissions(),
  ])

  const groups = await Promise.all(
    [...groupByEvent(items)].map(async ([eventId, group]) => ({
      group,
      timeZone: (await getEvent(eventId)).timezone,
    })),
  )

  const requests = groups.flatMap(({ group, timeZone }) =>
    toRequestUploadViews({ items: group, submissions, files, timeZone }),
  )

  return <RequestedFilesPanel requests={requests} />
}

/** Insertion-ordered, so the rendered order is the order the read returned. */
function groupByEvent(
  items: readonly FileRequestItem[],
): ReadonlyMap<string, readonly FileRequestItem[]> {
  const groups = new Map<string, FileRequestItem[]>()
  for (const item of items) {
    const held = groups.get(item.request.eventId)
    if (held === undefined) groups.set(item.request.eventId, [item])
    else held.push(item)
  }
  return groups
}
