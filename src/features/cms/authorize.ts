// Who may see and who may change an embed. R9.
//
// Two functions with two different jobs, and the difference is the security property.
//
// `isEventOrganizer` is the RENDER decision for the three admin pages. It does not redirect:
// the layout above has already done that, and it is not the enforcement either.
//
// `ownedEmbed` IS the enforcement, and every mutation calls it after `requireEventRole`. A
// Server Action is reachable by POST without any page or layout rendering (BUILD_SPEC 4), so a
// caller who holds admin on event A could otherwise post event B's record id to A's action and
// rename, disable or delete B's embed. Which for this feature means taking a live feed off a
// stranger's website, so the check is not optional and it is not the layout's.
//
// `admin`, never `reviewer`. `EVENT_ROLES` ranks admin above reviewer, so an organizer passes
// both; publishing a public data feed is not a review capability, and a reviewer who could
// disable an embed could take the conference's own agenda off its website.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { getCmsEmbed } from '@/services/airtable/reads-cms'
import type { CmsEmbed } from '@/types/cms'

export async function isEventOrganizer(eventId: string): Promise<boolean> {
  try {
    await requireEventRole(eventId, 'admin')
    return true
  } catch (error) {
    // Every AUTH_* failure means the same thing to a page: render nothing. Anything else is a
    // real fault and belongs in the error boundary.
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return false
    throw error
  }
}

/**
 * The embed, having verified it belongs to this event. Uncached read (reads-cms.ts).
 *
 * A mismatch raises `AUTH_FORBIDDEN_ROLE` rather than "not found", because that is what it is:
 * a caller who holds admin on this event and posted another event's record id.
 */
export async function ownedEmbed(eventId: string, embedId: string): Promise<CmsEmbed> {
  const embed = await getCmsEmbed(embedId)
  if (embed.eventId !== eventId) {
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'embed does not belong to event', {
      eventId,
      embedId,
    })
  }
  return embed
}
