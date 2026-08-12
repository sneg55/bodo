// The Accelevents detail, four sections top to bottom, in BUILD_SPEC 5.0d's order:
// Connection, Mappings, Sync log, Controls.
//
// It sits BELOW the registry rather than inside it, and the anchor id is what the row's
// `Settings` button points at. That is the one structural concession to Accelevents being
// the only provider with a detail surface today: the registry list stays generic, and this
// is a section the page composes next to it rather than a special case inside the row.
//
// The order is not cosmetic. An organizer reading top to bottom answers "is it hooked up",
// then "did anything land", then "what went wrong", then acts. Putting the controls first
// would invite pressing `Sync now` before reading why the last one failed.

import type { ReactNode } from 'react'

import { AccelConnectionCard } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/AccelConnectionCard'
import { AccelControls } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/AccelControls'
import { AccelMappingsTable } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/AccelMappingsTable'
import { AccelSyncLogTable } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/AccelSyncLogTable'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AccelConnection, MappingRow, SyncLogRowModel } from '@/features/integrations/reads'

export type AccelSectionProps = {
  eventId: string
  connection: AccelConnection
  mappings: readonly MappingRow[]
  logs: readonly SyncLogRowModel[]
  canRun: boolean
}

export function AccelSection({ eventId, connection, mappings, logs, canRun }: AccelSectionProps) {
  return (
    <section id="accelevents" className="flex min-w-0 flex-col gap-5 scroll-mt-6">
      <h3 className="font-heading text-base font-semibold">Accelevents</h3>

      <AccelConnectionCard eventId={eventId} connection={connection} />

      <div className="flex flex-col gap-2">
        <Heading
          title="Mappings"
          caption="Every local record with a counterpart on the far side."
        />
        <AccelMappingsTable rows={mappings} configured={connection.configured} />
      </div>

      <div className="flex flex-col gap-2">
        <Heading title="Sync log" caption="Every attempt writes a row, including the skips.">
          {/* Said on the page, not only in a comment. BUILD_SPEC 5.0d requires this
              section to declare itself, because it is the one surface here with no
              counterpart in the vendor's own product. The reason it is kept anyway is a
              paragraph, and a paragraph under a heading is what nobody reads, so it sits
              behind the badge that raises the question. */}
          <Tooltip>
            <TooltipTrigger className="cursor-help rounded-4xl">
              <Badge variant="outline">Not in the vendor&apos;s product</Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              Sessionboard documents no sync log: their articles route a failure to support with a
              screenshot. bodo keeps one because a failed row is inspectable here, and hiding it
              behind &quot;contact support&quot; would be copying a weakness.
            </TooltipContent>
          </Tooltip>
        </Heading>
        <AccelSyncLogTable rows={logs} configured={connection.configured} />
      </div>

      <div className="flex flex-col gap-2">
        <Heading
          title="Controls"
          caption="Sync now walks the whole event. Retry failed replays this event's failed attempts."
        />
        <AccelControls eventId={eventId} configured={connection.configured} canRun={canRun} />
      </div>
    </section>
  )
}

/**
 * A sub-section heading and its one-line caption.
 *
 * One line, and the limit is the point. Each of these used to carry two to four lines of
 * reasoning lifted out of the file comments, and three of them stacked down the page turned
 * a settings surface into a design document: the tables underneath them are what somebody
 * came here to read. Anything longer than the caption belongs in a tooltip on the chip that
 * raises the question, or in the comment above.
 */
function Heading({
  title,
  caption,
  children,
}: {
  title: string
  caption: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        {children}
      </div>
      <p className="text-sm text-muted-foreground">{caption}</p>
    </div>
  )
}
