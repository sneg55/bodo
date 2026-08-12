// Cache tag builders. Pure string functions, and the only place a tag is spelled.
//
// A read attaches them to its own request (reads.ts, reads-review.ts, reads-portal.ts,
// reads-identity.ts) and a write expires them through invalidate.ts. The vocabulary
// below is unchanged by that move, deliberately: the names are the contract between the
// two sides, and renaming one silently uncouples a screen from the write that feeds it.
//
// Granularity is the point, not duration (BUILD_SPEC 6.1). Accepting one
// submission must not invalidate the agenda, the dashboard and every list, so a
// write names the tags it actually affects and nothing else. A read with no tag is
// a bug, because nothing can ever invalidate it.
//
// The six in the conventions file (`event:{id}:submissions`, `event:{id}:agenda`,
// `event:{id}:agenda:published`, `event:{id}:forms`, `speaker:{id}`,
// `submission:{id}`) are here verbatim. The rest are the same shape, added for
// reads that exist in this DAL and would otherwise be untagged: the event record
// itself, the event-scoped lookups, the speaker list, the review graph, the
// evaluation plan, and a form addressed by its public id (the public CFP page
// resolves a form before it knows which event it belongs to).

import type { RecordId } from '@/types/domain'

/** The event record: name, dates, timezone, CFP deadline. */
export const eventTag = (eventId: RecordId): string => `event:${eventId}`

export const eventSubmissionsTag = (eventId: RecordId): string => `event:${eventId}:submissions`

/** Room and time assignments. Separate from the submission list on purpose. */
export const eventAgendaTag = (eventId: RecordId): string => `event:${eventId}:agenda`

/** What the public embeds read, so it survives an unpublished reshuffle. */
export const eventAgendaPublishedTag = (eventId: RecordId): string =>
  `event:${eventId}:agenda:published`

export const eventFormsTag = (eventId: RecordId): string => `event:${eventId}:forms`

/** Tracks, tags and rooms: the pickers on nearly every admin screen. */
export const eventLookupsTag = (eventId: RecordId): string => `event:${eventId}:lookups`

export const eventSpeakersTag = (eventId: RecordId): string => `event:${eventId}:speakers`

/** Assignments and reviews. A saved score must not expire the abstracts list. */
export const eventReviewTag = (eventId: RecordId): string => `event:${eventId}:review`

/** The evaluation plan and its rounds. Changes once a cycle, read constantly. */
export const eventPlanTag = (eventId: RecordId): string => `event:${eventId}:plan`

/**
 * Task assignments for the whole event: the admin Tasks board and its tab counts.
 * Separate from the submission list, because fanning tasks out on accept must not
 * expire every abstracts table in the product.
 */
export const eventTasksTag = (eventId: RecordId): string => `event:${eventId}:tasks`

/**
 * One speaker's own task list. Per speaker rather than per event, so a speaker
 * ticking off their headshot upload does not expire the portal of every other
 * speaker at the conference.
 */
export const speakerTasksTag = (speakerId: RecordId): string => `speaker:${speakerId}:tasks`

/**
 * The event's resource pages and the PortalItems rows that publish them.
 *
 * One tag for both tables, not two, and that is a deliberate choice about granularity
 * rather than a shortcut: every read of one needs the other (a page is only visible if its
 * item is enabled, so the join is the read), and every write to one is a write to the pair
 * (saving a page writes the row and its publishing flag together). Two tags would always
 * be named together on both sides, which is one tag with extra steps.
 *
 * Separate from `event:{id}:tasks` even though PortalItems also holds task rows, because
 * an organizer editing a resource must not expire every speaker's task list.
 */
export const eventResourcesTag = (eventId: RecordId): string => `event:${eventId}:resources`

/**
 * The event's Portals rows, and therefore the same tag PortalItems already lives under.
 *
 * NOT a new tag, and that is the whole point of it being an alias: `listPortalItems` and
 * `listResources` share `eventResourcesTag`, and a Portals read under a tag of its own
 * would let one of the three expire while the other two served the answer they had before
 * the portal was reordered. First-match-wins means a stale `order` is a contact in the
 * wrong portal, so the three reads keep one cache identity. BUILD_SPEC 5.0c.
 *
 * It exists as a named function rather than as call sites reaching for the resources tag
 * because the two features are otherwise unrelated, and a reader of `savePortal` should
 * not have to know that resources are why.
 */
export const eventPortalsTag = eventResourcesTag

/**
 * Everything on the Integrations page for one event: `IntegrationMappings`, `SyncLog`,
 * and the `ImportRuns` history under each provider row.
 *
 * One tag for all three, for the reason the resources tag gives: the page reads them
 * together and every control on it writes to more than one. A push writes a mapping and a
 * log row; an import writes a run row and a mapping per record it creates.
 *
 * Note that the cron sweep does NOT name this tag, and does not need to: its reads are
 * uncached by construction (reads-portal.ts explains why a job never reads from cache), so
 * there is nothing for it to expire.
 */
export const eventIntegrationsTag = (eventId: RecordId): string => `event:${eventId}:integrations`

/**
 * The event's file requests and every assignment against them: the admin File Requests
 * list, its tab counts and its delivery table.
 *
 * Separate from `event:{id}:tasks` even though the two surfaces look alike, because a
 * document arriving must not expire every speaker's task list. Named by every file request
 * write, which is what lets the per-speaker tag below be the narrow one.
 */
export const eventFileRequestsTag = (eventId: RecordId): string => `event:${eventId}:file-requests`

/**
 * One speaker's own requested documents. Per speaker rather than per event, so one person
 * uploading their headshot release does not expire the portal of every other speaker.
 */
export const speakerFileRequestsTag = (speakerId: RecordId): string =>
  `speaker:${speakerId}:file-requests`

/** Files owned by one speaker, across submissions. */
export const speakerFilesTag = (speakerId: RecordId): string => `speaker:${speakerId}:files`

/** Files attached to one submission, which is what the portal detail page lists. */
export const submissionFilesTag = (submissionId: RecordId): string =>
  `submission:${submissionId}:files`

/**
 * One submission's edit history.
 *
 * Per submission and not per event, deliberately, on the granularity rule in the
 * conventions file: the history is read on one detail page and appended to by an edit of
 * that same record, so an event-wide tag would expire every other submission's page
 * because somebody fixed a typo in one title.
 */
export const submissionRevisionsTag = (submissionId: RecordId): string =>
  `submission:${submissionId}:revisions`

/**
 * Every file the event's speakers have uploaded: the two admin Files lists.
 *
 * The Files table has NO event link, so this tag cannot be derived from a record the way
 * the two above are. It is named explicitly by `createFileRecord`, which is why that
 * function takes an `eventId` it does not store: an event-wide list has to expire when any
 * one of its speakers uploads, and neither the per-speaker nor the per-submission tag says
 * anything about the event a file landed in.
 */
export const eventFilesTag = (eventId: RecordId): string => `event:${eventId}:files`

/**
 * The queue itself, for the Comms log. Not read by the sender: draining is a job, not
 * a page, and it reads uncached so two overlapping cron runs cannot both be handed the
 * same rows out of a cache.
 */
export const eventOutboxTag = (eventId: RecordId): string => `event:${eventId}:outbox`

/**
 * The event's saved views, across every list surface.
 *
 * One tag rather than one per surface. A saved view is read once per navigation of the
 * list it belongs to, an organizer creates a handful per event, and the write that expires
 * this is the same write that changes the menu the organizer is looking at. Splitting it
 * per surface would name two tags on every default change (the surface being made default
 * and the one losing it are the same surface, so it would buy nothing) and add a tag
 * vocabulary entry with no reader of its own.
 */
export const eventSavedViewsTag = (eventId: RecordId): string => `event:${eventId}:saved-views`

/**
 * The event's EmailTemplates rows: the bodies the notification triggers prefer over their
 * in-code defaults (`@/features/comms/resolve-template`).
 *
 * Separate from `event:{id}:outbox` even though both belong to the comms layer, and the
 * reason is the direction each one points. The outbox tag is the LOG of what has been
 * queued, expired every time a trigger writes a row; this one is the SOURCE an organizer
 * edits, expired only when a template is saved. Sharing a tag would expire every builder
 * screen on every acceptance email, and expire the Comms log when nothing was sent.
 */
export const eventEmailTemplatesTag = (eventId: RecordId): string =>
  `event:${eventId}:email-templates`

/** The event's webhook subscriptions. Deliveries are uncached, so they carry no tag of their
 *  own; reads-webhooks.ts is where that whole decision is written down. */
export const eventWebhooksTag = (eventId: RecordId): string => `event:${eventId}:webhooks`

export const speakerTag = (speakerId: RecordId): string => `speaker:${speakerId}`

export const submissionTag = (submissionId: RecordId): string => `submission:${submissionId}`

/**
 * Keyed on `publicId`, not the record id, because that is what the public URL
 * carries and therefore what the cached read is keyed on.
 */
export const formPublicTag = (publicId: string): string => `form:${publicId}`

/**
 * An event addressed by the slug in a public URL (`/agenda/<slug>`), for the same
 * reason `formPublicTag` exists: the record id is not knowable until the record has
 * been read, and a request's tags have to be set before it goes out. Separate from
 * `event:{id}` rather than an alias of it, so a slug that resolves to nothing is
 * still an expirable cache entry.
 */
export const eventSlugTag = (slug: string): string => `event:slug:${slug}`

/**
 * Everything one user's capability depends on. Invalidated by Event Team add,
 * remove, and role change, which is what makes revocation take effect on the next
 * request instead of when a 30 day session token happens to expire.
 */
export function userMembershipsTag(userId: string): string {
  return `user:${userId}:memberships`
}

/**
 * The whole `AdminUsers` table, which is what the team read actually fetches.
 *
 * Global and id-less, like `speakerTagsTag`, because the read is: `readEventTeam` pages
 * the entire table and filters in code, so every event's team page issues the SAME
 * Airtable request. The Data Cache keys on that request, which means one entry serves
 * every event and carries whichever event's tag happened to populate it. `event:{id}`
 * alone is therefore not a reliable subscription for it: an organizer renaming themselves
 * on event A can leave the entry that event B is being served, tagged only `event:B`,
 * untouched.
 *
 * So the users half of that read subscribes to this as well, and the two writes to
 * `AdminUsers` (create on invite, rename on the profile page) both name it. The event tags
 * stay on the read too, because a membership change is still an event change and expiring
 * one page's team must not require knowing that a shared cache entry exists.
 */
export const adminUsersTag = (): string => 'admin-users'

/** The speaker tag vocabulary is global, not per event, so it takes no id. */
export const speakerTagsTag = (): string => 'speaker-tags'

/**
 * Every issued API token, for the settings page that lists them.
 *
 * Global and id-less like `adminUsersTag` above, and for the same reason rather than by
 * analogy: `ApiTokens` carries no `event` link at all (see `src/migrations/tables-api.ts`),
 * so there is no per-event subscription that could exist.
 *
 * **Nothing on the authentication path subscribes to this.** `findApiToken` is uncached
 * outright, because a cached credential outlives its own revocation; this tag covers only
 * the rendered list, where being a minute stale costs nobody anything.
 */
export const apiTokensTag = (): string => 'api-tokens'

export const userSpeakerListsTag = (userId: RecordId): string => `user:${userId}:speaker-lists`

/**
 * The shared-list dimension of SpeakerLists, as one tag rather than per-user.
 *
 * `listSpeakerLists(userId)` (reads-crm.ts) reads the WHOLE `SpeakerLists` table - it has
 * to, because "may this caller see it" depends on a row's `ownerId` and `isShared`, neither
 * knowable before the row is read - but filters to what `userId` may actually see (their
 * own rows, plus every `isShared` one) before returning, and caches that read only under
 * the CALLING user's own `userSpeakerListsTag`. A write by user A therefore cannot reach
 * user B's cached copy through that tag alone: A shares, renames, or DELETES a list, and
 * B keeps being served the old row until B's own window lapses, which for a delete means B
 * is shown a list that no longer exists. This tag is the second subscription every list
 * read carries, and both `saveSpeakerList` and `deleteSpeakerList` name it UNCONDITIONALLY,
 * not only when the row is (or was) shared: on delete the row is gone and its `isShared`
 * value cannot be read without a second fetch, and an unshare transition has to expire the
 * tag it is LEAVING as well as the one it is joining, so a conditional would have to get
 * both directions of that transition right to be worth less than just always naming it.
 * The extra invalidation this buys is bounded and cheap, because saved lists are a handful
 * per organization and are written rarely. Governing rule: no cached read may serve a row
 * that no write is able to expire.
 */
export const sharedSpeakerListsTag = (): string => 'speaker-lists:shared'

/**
 * A speaker's sent mail. Distinct from `eventOutboxTag` because the CRM timeline reads
 * across events: an event-scoped tag would not be expired by a send on another event.
 */
export const speakerCommsTag = (speakerId: RecordId): string => `speaker:${speakerId}:comms`

/**
 * One contact's internal notes, on the CRM profile.
 *
 * Per speaker and not per event, because the notes are: an organizer writing "wants a
 * morning slot, travels from Lagos" is recording something about the person that outlives
 * the conference they wrote it on. Distinct from `speakerTag(speakerId)`, which is the
 * Speakers ROW: appending a note changes no field on that row, so sharing the tag would
 * expire every roster and every directory in the product to redraw one card.
 */
export const speakerNotesTag = (speakerId: RecordId): string => `speaker:${speakerId}:notes`

/**
 * One contact's stage-transition history, on the CRM profile.
 *
 * Separate from `speakerNotesTag` even though both hang off the same card, and for the
 * granularity reason in the conventions file rather than tidiness: a stage move writes the
 * history and the Speakers row and nothing else, and a typed note writes neither. Sharing
 * one tag would make every note an organizer types expire a cache entry it did not change.
 */
export const speakerStageHistoryTag = (speakerId: RecordId): string =>
  `speaker:${speakerId}:stage-history`
