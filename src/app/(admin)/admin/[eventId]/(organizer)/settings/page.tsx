// Event Settings > Overview: the launcher (docs/parity/event-config.md ref 02).
//
// Four groups of card links, each an icon plus a blue link title plus a grey description.
// Headings, titles and descriptions come from `settingsOverview`, which resolves each
// card's href from the sub-nav by id so a card and its nav entry cannot point at two
// different places.
//
// Reads nothing, so there is nothing to stream and no reason for a body child.

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { requireEventId } from '@/features/events/resolve-ref'
import { settingsOverview } from '@/features/settings/overview'

export const metadata = { title: 'Event Settings' }

export default async function SettingsOverviewPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)

  return (
    <div className="flex min-w-0 flex-col gap-7">
      {settingsOverview(eventId).map((section) => (
        <section key={section.id} className="flex flex-col gap-3">
          <h2 className="meta text-muted-foreground">{section.heading}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {section.cards.map((card) => (
              <Link
                key={card.id}
                href={card.href}
                className="flex items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                {/* The tinted icon tile ref 02 puts on every overview card, in
                    bodo's accent rather than Sessionboard's blue-50. */}
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center border border-primary/35 bg-primary/8 text-primary">
                  <card.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  {/* No out-of-scope badge here any more, and none is needed: Record Settings
                      was the only card that opened a "Not part of this build" page, and it was
                      removed from the sub-nav and this launcher together. Every card left opens
                      a section that exists. Re-add a badge only alongside a card that does not. */}
                  <span className="text-sm font-medium text-primary">{card.title}</span>
                  <span className="block text-sm text-muted-foreground">{card.description}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
