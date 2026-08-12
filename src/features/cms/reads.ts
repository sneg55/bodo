// The reads behind R9's three pages. Composition only: every cache tag and window is declared
// where the fetch happens, in the DAL (read-cache.ts).
//
// The one with a rule in it is `readServedEmbed`, and the rule is about the ORDER of two checks.
// An unknown `publicId` and a disabled embed must be indistinguishable from outside, and both
// have to be answered before the first byte, so this returns `undefined` for either and the
// route calls `notFound()` in its own body. On Workers a `notFound()` reached from inside a
// `<Suspense>` boundary renders the 404 body with a 200 status line, which for an embed means a
// third-party page quietly displaying our not-found copy inside its own layout.
//
// The early return on `enabled` is a read-avoidance shortcut, not the authority: a disabled
// embed must not cost an event read, three list reads and a projection just to be refused. The
// authority is `embedProjection`, which returns `undefined` for a disabled embed and is tested
// for it (tests/cms-embed-projection.test.ts), so removing the shortcut would slow this down and
// change nothing about what is served.

import { describeSessions } from '@/features/agenda/public-descriptions'
import { type EmbedDeepLink, parseEmbedDeepLink, type RawParams } from '@/features/cms/deep-link'
import { type EmbedFilterGroup, embedFilterGroups } from '@/features/cms/filter-options'
import { type EmbedProjection, embedProjection } from '@/features/cms/projection'
import { publicSiteEmbed } from '@/features/cms/public-site'
import {
  getCmsEmbedByPublicId,
  getEvent,
  listCmsEmbeds,
  listForms,
  listPublishedAgenda,
  listRooms,
  listTags,
  listTracks,
} from '@/services/airtable/queries'
import type { CmsEmbed, EmbedView } from '@/types/cms'
import type { Event } from '@/types/domain'

/** Ref 32's list. Unfiltered: the segmented control counts the disabled rows too. */
export async function readEmbeds(eventId: string): Promise<readonly CmsEmbed[]> {
  return await listCmsEmbeds(eventId)
}

export type EmbedEditorData = {
  embed: CmsEmbed
  event: Event
  /** What the Filters section offers, built off this event (@/features/cms/filter-options). */
  filterGroups: readonly EmbedFilterGroup[]
}

/**
 * Ref 33's editor. `undefined` when the id does not name an embed on THIS event.
 *
 * The event-ownership check is here and not only in the actions, because an admin of event A
 * opening event B's embed id would otherwise read B's name and view off the page. The actions
 * re-check it themselves (./authorize) since they are reachable without this page.
 *
 * Five reads rather than two, and the three added ones are what makes the Filters section real: a
 * panel of checkboxes has to be built from this event's tracks, rooms and tags, and its format and
 * language choices are derived from the rows the embed can serve. All five are cached and tagged
 * where their fetch happens, and they run in parallel, so the section costs one round trip on a
 * cold cache and none on a warm one.
 */
export async function readEmbedEditor(
  eventId: string,
  embedId: string,
): Promise<EmbedEditorData | undefined> {
  const [embeds, event, tracks, rooms, tags, rows] = await Promise.all([
    listCmsEmbeds(eventId),
    getEvent(eventId),
    listTracks(eventId),
    listRooms(eventId),
    listTags(eventId),
    listPublishedAgenda(eventId),
  ])
  const embed = embeds.find((candidate) => candidate.id === embedId)
  if (embed === undefined) return undefined
  return { embed, event, filterGroups: embedFilterGroups({ tracks, rooms, tags, rows }) }
}

/**
 * The served feed, or `undefined` for "this URL does not resolve".
 *
 * Four reads, all cached and tagged, three of them in parallel: a visitor on somebody else's
 * website costs no Airtable round trip once the entries are warm, and `listPublishedAgenda`
 * applies the public visibility rule on the way through (queries.ts) before the projection
 * applies it again.
 */
/**
 * One page of the event's OWN public site, rendered from the same projection an embed uses.
 *
 * The event is resolved by the caller and passed in, not looked up here, because the page has to
 * `notFound()` on an unknown slug in its own BODY: on Workers a `notFound()` reached from inside
 * a `<Suspense>` boundary renders the 404 body behind a 200 status line, and this read is what
 * that boundary is waiting on.
 *
 * `deepLink` is honoured, so `?sb-speaker-id=` narrows the public site exactly as it narrows an
 * embed. `sb-view` is deliberately NOT passed through: on this site the URL segment is what picks
 * the layout, and letting a query parameter override it would give every surface five addresses.
 *
 * Four reads, all cached and tagged where their fetch happens, all in parallel. The visibility
 * rule is applied inside `listPublishedAgenda` before the projection applies it again.
 */
export async function readPublicSiteSurface(input: {
  event: Pick<Event, 'id' | 'name' | 'timezone'>
  view: EmbedView
  params: RawParams
}): Promise<EmbedProjection | undefined> {
  const [rows, rooms, tracks, forms] = await Promise.all([
    listPublishedAgenda(input.event.id),
    listRooms(input.event.id),
    listTracks(input.event.id),
    listForms(input.event.id),
  ])
  const describe = describeSessions(forms)
  // Rebuilt rather than spread with `view` dropped, so a third deep-link parameter added later
  // has to be admitted here on purpose instead of arriving by accident.
  const parsed = parseEmbedDeepLink(input.params)
  const deepLink: EmbedDeepLink =
    parsed.speakerId === undefined ? {} : { speakerId: parsed.speakerId }

  return embedProjection({
    embed: publicSiteEmbed(input.view),
    event: { name: input.event.name, timezone: input.event.timezone },
    rows: rows.map((row) => ({ ...row, description: describe(row) })),
    rooms,
    tracks,
    deepLink,
  })
}

export async function readServedEmbed(
  publicId: string,
  params: RawParams,
): Promise<EmbedProjection | undefined> {
  const embed = await getCmsEmbedByPublicId(publicId)
  if (embed === undefined || !embed.enabled) return undefined

  const deepLink: EmbedDeepLink = parseEmbedDeepLink(params)
  const [event, rows, rooms, tracks, forms] = await Promise.all([
    getEvent(embed.eventId),
    listPublishedAgenda(embed.eventId),
    listRooms(embed.eventId),
    listTracks(embed.eventId),
    // The fifth read, and it buys the abstract on a session card: `description` is not a
    // column, so it lives in `answersJson` under a form field's id. See `describeSessions`.
    listForms(embed.eventId),
  ])
  const describe = describeSessions(forms)

  return embedProjection({
    embed,
    // Only the name and the timezone cross into the projection. The event's record id, its
    // slug, its Accelevents ids and its CFP settings do not: this output is rendered on a page
    // this app does not control, so it carries what the public agenda already shows and no more.
    event: { name: event.name, timezone: event.timezone },
    rows: rows.map((row) => ({ ...row, description: describe(row) })),
    rooms,
    tracks,
    deepLink,
  })
}
