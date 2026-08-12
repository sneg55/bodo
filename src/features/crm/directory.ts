// The cross-event speaker directory: the CRM's main surface, assembled server-side.
//
// The page above this file wires `searchParams` and renders. Everything that decides what
// the table contains is here, because `src/app/**` holds routes only.
//
// Reads, and what each one is for:
//   - `listSpeakersInEvents(scope.eventIds)` is the roster AND the Events count. One read
//     for the whole scope, sorted by family name, keeping the event links that were
//     already in the records it paged through. This used to be the roster plus one
//     `listSpeakers(eventId)` per event, which was the identical whole-table scan repeated
//     once per event under a different cache key: a viewer in twelve events paid twelve of
//     them for links the first read had already seen and thrown away.
//   - `listSubmissions(eventId)` per event answers the Sessions count, off the cast that
//     read already carries. This one is genuinely per event: it is a different table, a
//     different tag, and a different set of records each time.
//   - `listSpeakerTags()` and `listSpeakerTagMembership()` are the vocabulary and the
//     membership, one read each for the whole table. NOT `listSpeakerTagIds` per row: that
//     is the per-row fan-out `services/airtable/scheduler.ts` exists to prevent, and tag
//     filtering needs membership across the whole scope rather than the visible page.
//   - `listSpeakerLists(userId)` is the toolbar's Lists control: this viewer's own saved
//     filter sets plus every shared one. Issued alongside the rest rather than in the page,
//     so applying a list costs no extra round trip and `src/app/**` stays routes only.
//
// So the fan-out is ONE read per event the viewer belongs to plus four flat ones, issued
// in parallel, every one of them tagged and cached (`event:{id}:speakers`,
// `event:{id}:submissions`, `speaker-tags`) and most of them already primed by the event's
// own Abstracts and Agenda screens.

import type { CrmQueryState } from '@/features/crm/directory-query'
import {
  type DuplicateReason,
  duplicateReasons,
  findDuplicateClusters,
} from '@/features/crm/duplicates'
import { type AddableEvent, loadAddableEvents } from '@/features/crm/profile-activity'
import type { CrmScope } from '@/features/crm/scope'
import {
  buildSpeakerRows,
  SPEAKER_ACCESSORS,
  type SpeakerEventSessions,
  type SpeakerRow,
  sessionCounts,
} from '@/features/crm/speaker-rows'
import { matchesFilters, matchesSearch, pageRows, sortRows } from '@/features/views/table-query'
import {
  listSpeakerLists,
  listSpeakersInEvents,
  listSpeakerTagMembership,
  listSpeakerTags,
  listSubmissions,
} from '@/services/airtable/queries'
import type { RecordId, SpeakerList, SpeakerTag } from '@/types/domain'

/** How much of the directory looks duplicated, over the whole scope rather than the page. */
export type DuplicateSummary = {
  readonly clusters: number
  readonly records: number
}

export type CrmDirectoryView = {
  /** The current page, already sliced. */
  readonly rows: readonly SpeakerRow[]
  /** Rows the query matched, which is what the footer counts. */
  readonly totalRows: number
  /** Clamped, so a stale page number cannot render an empty table for no reason. */
  readonly page: number
  /** Every speaker in scope, before the query. The header's subtitle counts these. */
  readonly speakerCount: number
  /** How many events the viewer's membership set covers. Also for the subtitle. */
  readonly eventCount: number
  /**
   * The saved filter sets the toolbar's Lists control offers: this viewer's own, plus every
   * shared one. Part of the view rather than a second read in the page, because
   * `src/app/**` holds routes only and the page already renders exactly what this returns.
   */
  readonly lists: readonly SpeakerList[]
  /**
   * The viewer, so the control can tell a list they may rename or delete from one they may
   * only apply. It decides what the MENU offers; the actions re-derive it for themselves.
   */
  readonly userId: RecordId
  /**
   * Which visible rows look like a duplicate of another record, and why.
   *
   * Computed over EVERY row in scope and then narrowed to the page, which is the only order
   * that works: a row whose twin sits on page 3 has to carry the badge on page 1, and a
   * page-scoped scan would say it is unique. The map is the page's, so the payload does not
   * carry the ids of rows the browser cannot see.
   */
  readonly duplicateReasons: ReadonlyMap<RecordId, DuplicateReason>
  /**
   * The toolbar's count: how many records across how many clusters, over the whole scope.
   *
   * A summary rather than the clusters themselves. The merge dialog works from the rows the
   * organizer ticked, which the page already carries, so shipping every cluster's ids would
   * put rows the browser is not showing into the payload to render one number.
   */
  readonly duplicateSummary: DuplicateSummary
  /**
   * Whether this viewer may merge at all: they hold `admin` on at least one event.
   *
   * Merging deletes records, so it is gated on the write scope rather than the read scope
   * (`merge-actions.ts`). A reviewer would be refused by the action, and a control that
   * always refuses is worse than no control, so the surface does not draw one.
   */
  readonly canMerge: boolean
  /**
   * The events a NEW contact can be created on: the ones this viewer holds `admin` over.
   *
   * Empty for a reviewer, which is what leaves `Add Contact` off the header entirely, the
   * same call `loadAddableEvents` already makes for the profile's `Add To Event`. Creating a
   * contact links them to an event, so it is a write, and a control that can only be refused
   * is worse than no control. `createContactAction` re-derives the same answer for itself.
   */
  readonly creatableEvents: readonly AddableEvent[]
}

/**
 * Tag ids to the tags themselves.
 *
 * The membership read answers in tag IDS, because that is what the link holds; the
 * vocabulary read is what turns an id into a name and a colour. An id the vocabulary does
 * not have is dropped rather than rendered as a blank chip: the two reads share a cache tag
 * but not a cache entry, so a tag deleted between them is a real, if narrow, window.
 *
 * Exported because the profile (`features/crm/profile.ts`) resolves ONE speaker's tags and
 * must apply the same rule. Two copies of "drop what the vocabulary does not know" is how
 * one surface starts rendering blank chips while the other does not.
 */
export function resolveSpeakerTags(
  tagIds: readonly RecordId[],
  byId: ReadonlyMap<RecordId, SpeakerTag>,
): readonly SpeakerTag[] {
  return tagIds.flatMap((tagId) => {
    const tag = byId.get(tagId)
    return tag === undefined ? [] : [tag]
  })
}

/** The vocabulary as a lookup. One place builds it, so both callers key it the same way. */
export function speakerTagsById(
  vocabulary: readonly SpeakerTag[],
): ReadonlyMap<RecordId, SpeakerTag> {
  return new Map(vocabulary.map((tag) => [tag.id, tag]))
}

/** Speaker id to the tags that speaker carries, resolved once for the whole scope. */
export function tagsBySpeaker(
  membership: ReadonlyMap<RecordId, readonly RecordId[]>,
  vocabulary: readonly SpeakerTag[],
): ReadonlyMap<RecordId, readonly SpeakerTag[]> {
  const byId = speakerTagsById(vocabulary)
  return new Map(
    [...membership].map(([speakerId, tagIds]) => [speakerId, resolveSpeakerTags(tagIds, byId)]),
  )
}

async function eventSessions(eventId: RecordId): Promise<SpeakerEventSessions> {
  const submissions = await listSubmissions(eventId)
  return {
    eventId,
    sessionCasts: submissions.map((submission) =>
      submission.participants.map((participant) => participant.speaker.id),
    ),
  }
}

export async function loadCrmDirectory(
  scope: CrmScope,
  query: CrmQueryState,
): Promise<CrmDirectoryView> {
  const [speakers, activity, vocabulary, membership, lists, creatableEvents] = await Promise.all([
    listSpeakersInEvents(scope.eventIds),
    Promise.all(scope.eventIds.map(eventSessions)),
    listSpeakerTags(),
    listSpeakerTagMembership(),
    listSpeakerLists(scope.userId),
    // Issued alongside the rest rather than in the page, so the Add Contact dialog can name
    // its events without a second round trip. `[]` because no contact exists yet, so every
    // admin event is a candidate; the reads behind it are single records on `REVALIDATE.lookup`
    // that the sidebar has already primed, and there are none at all for a reviewer.
    loadAddableEvents(scope, []),
  ])

  const rows = buildSpeakerRows(speakers, {
    sessionCounts: sessionCounts(activity),
    tagsBySpeaker: tagsBySpeaker(membership, vocabulary),
  })

  // Over every row in scope, BEFORE the search, the filters and the page. All three are
  // subsets, and duplicate detection asks a question about the whole set: two records for
  // one person differ by definition, so a filter that keeps one routinely drops the other,
  // and the survivor would then look unique. See `findDuplicateClusters`.
  const clusters = findDuplicateClusters(rows.map((row) => row.speaker))
  const reasons = duplicateReasons(clusters)

  const matched = rows.filter(
    (row) =>
      (!query.duplicatesOnly || reasons.has(row.speaker.id)) &&
      matchesSearch(row, query.search, SPEAKER_ACCESSORS) &&
      matchesFilters(row, query.filters, SPEAKER_ACCESSORS),
  )
  const paged = pageRows(
    sortRows(matched, query.sort, SPEAKER_ACCESSORS),
    query.page,
    query.pageSize,
  )

  return {
    rows: paged.rows,
    totalRows: paged.totalRows,
    page: paged.page,
    speakerCount: rows.length,
    eventCount: scope.eventIds.length,
    duplicateReasons: new Map(
      paged.rows.flatMap((row) => {
        const reason = reasons.get(row.speaker.id)
        return reason === undefined ? [] : [[row.speaker.id, reason] as const]
      }),
    ),
    duplicateSummary: { clusters: clusters.length, records: reasons.size },
    canMerge: scope.adminEventIds.length > 0,
    creatableEvents,
    // Not re-filtered. `listSpeakerLists` applies `visibleLists` itself and is the one place
    // that rule runs; a second application here could never change an outcome, and two
    // copies of "who may see this" is how one of them ends up being the tested one while the
    // other is the one that matters.
    lists,
    userId: scope.userId,
  }
}
