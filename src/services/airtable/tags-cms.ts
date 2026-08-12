// Cache tags for CmsEmbeds. Same shape and same contract as tags.ts.
//
// Its own file rather than two more exports on tags.ts, for one reason that matters and one
// that does not. The one that matters: an embed is addressable two ways, and the pair has to
// be reasoned about together. The admin list is read by event id, the served embed is read
// by the `publicId` in a URL that a stranger's website holds, and a write that expires only
// the first leaves the public embed serving the previous name and the previous view for the
// rest of its window. Forms has exactly this pair (`eventFormsTag` plus `formPublicTag`) and
// mutations-forms.ts exists mostly to make sure both are always named.
//
// The one that does not: tags.ts is being edited concurrently for the dashboard surface.

import type { RecordId } from '@/types/domain'

/** Every embed on one event: the admin list and the editor. */
export const eventEmbedsTag = (eventId: RecordId): string => `event:${eventId}:embeds`

/**
 * One embed addressed by the id in its public URL.
 *
 * Keyed on `publicId` and not the record id, because that is what the request carries and
 * therefore what the cached read is keyed on: a request's tags have to be set before it goes
 * out, and the embed's event is not knowable until the record has come back. Separate from
 * `event:{id}:embeds` rather than an alias, so a `publicId` that resolves to nothing is
 * still an expirable cache entry and creating an embed does not have to guess.
 */
export const embedPublicTag = (publicId: string): string => `embed:${publicId}`
