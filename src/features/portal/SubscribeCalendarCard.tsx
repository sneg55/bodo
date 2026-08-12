// "Subscribe to my schedule" on the portal home.
//
// The `.ics` feed behind this has existed since the CMS embeds shipped. Nothing linked to it,
// so a speaker's only route to their own sessions in their own calendar was the one-off invite
// mailed at acceptance, which goes stale the first time a room changes. See
// `./calendar-subscription.ts` for why the button emits `webcal://` rather than `https://`.
//
// **It renders NOTHING when the organizer has no enabled embed**, rather than a disabled
// control or an explanation. There is genuinely no feed to subscribe to in that case, and a
// greyed-out button on a speaker's home page is a promise bodo cannot keep and that the
// speaker cannot act on: the fix is on the organizer's side and they are not the one reading
// this screen.

import { CalendarPlusIcon } from 'lucide-react'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireSpeaker } from '@/features/auth/wiring'
import { readEmbeds } from '@/features/cms/reads'
import { calendarFeedUrl, calendarSubscriptionUrl } from '@/features/portal/calendar-subscription'
import { portalEventIds } from '@/features/portal/event-scope'
import { appUrl } from '@/utils/env'

export async function SubscribeCalendarCard() {
  const { speakerId } = await requireSpeaker()
  const publicId = await firstEnabledEmbed(speakerId)
  if (publicId === undefined) return null

  const shared = { appUrl: appUrl(), publicId, speakerId }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your schedule</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Subscribe once and your sessions stay up to date in your own calendar, including any time
          or room changes the organizers make later.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={calendarSubscriptionUrl(shared)}>
            <CalendarPlusIcon />
            Subscribe to my schedule
          </ButtonLink>
          {/* The plain https form beside it, because a browser with no `webcal` handler
              registered does nothing at all when the button above is clicked. */}
          <ButtonLink href={calendarFeedUrl(shared)} variant="ghost" size="sm">
            Copy feed link
          </ButtonLink>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * The `publicId` of an embed this speaker's schedule is actually served by, or `undefined`.
 *
 * The speaker's events come first and the embeds are read per event, because a speaker can be
 * on more than one event (that scoping was fixed on 2026-08-10) and only the organizer of one
 * of them may have published a feed.
 *
 * A read failure resolves to `undefined` rather than throwing. This card is one of four on the
 * portal home and it is the least important of them: an embeds read that fails must not be
 * able to take down a speaker's view of their own submissions and tasks.
 */
async function firstEnabledEmbed(speakerId: string): Promise<string | undefined> {
  try {
    const eventIds = await portalEventIds(speakerId)
    const perEvent = await Promise.all(eventIds.map(async (id) => await readEmbeds(id)))
    return perEvent.flat().find((embed) => embed.enabled)?.publicId
  } catch {
    return undefined
  }
}
