// The sourcing pipeline board: one column per stage, one card per contact.
//
// A SERVER component, deliberately, even though every card carries a menu. The only
// interactive part is `SpeakerStageControl`, which is a client component of its own, so
// making the board a client component would ship the whole grid's markup twice to serve one
// button per card. This is the payload rule BUILD_SPEC section 6.3 states, and it is the same
// call `StatusChip` makes for the submission lists.
//
// Columns are a horizontally scrolling row of fixed-width tracks rather than a responsive
// grid. Five columns squeezed into a phone's width is five columns of one word each; a board
// that scrolls sideways is what a board is, and each column scrolls vertically inside itself
// so the header row stays put.
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe; the column headings are `SPEAKER_STATUS_LABELS` verbatim, which is what the
// event roster's tab strip already draws.

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CrmPendingLink } from '@/features/crm/CrmPendingLink'
import {
  PIPELINE_COLUMN_CAP,
  type PipelineBoardView,
  type PipelineCard,
  type PipelineColumn,
} from '@/features/crm/pipeline'
import { SpeakerStageControl } from '@/features/crm/SpeakerStageControl'

export function PipelineBoard({ view }: { view: PipelineBoardView }) {
  if (view.total === 0) {
    return (
      <p className="pt-4 text-sm text-muted-foreground">
        No contacts yet. They arrive from a CFP submission, an import, or Add Speaker on an event.
      </p>
    )
  }

  return (
    <div className="flex gap-4 overflow-x-auto pt-4 pb-2">
      {view.columns.map((column) => (
        <Column key={column.status} column={column} />
      ))}
    </div>
  )
}

function Column({ column }: { column: PipelineColumn }) {
  return (
    <section className="flex w-72 shrink-0 flex-col gap-2" aria-label={column.label}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-medium">{column.label}</h2>
        <Badge variant="secondary" className="tabular-nums">
          {column.total}
        </Badge>
      </div>

      {column.cards.length === 0 ? (
        // An empty column still renders its heading and says so, for the reason
        // `pipelineColumns` gives: the board is also how an organizer learns the vocabulary
        // exists, and a column that vanishes changes the board's shape between visits.
        <p className="px-1 text-xs text-muted-foreground">Nobody here.</p>
      ) : (
        // `h-`, not `max-h-`. A `ScrollArea` needs a DEFINITE height: its viewport is
        // `size-full`, and a percentage height inside a parent whose own height is `auto`
        // resolves to auto too, so the column never became a scroller and its cards simply
        // ran off the bottom of the page. Fifteen prospects was enough to see it.
        //
        // A column filling the space under the header is what this board wants anyway, so
        // the fixed height costs nothing here even when a column is short.
        <ScrollArea className="h-[calc(100vh-16rem)]">
          <div className="flex flex-col gap-2 pr-3">
            {column.cards.map((card) => (
              <ContactCard key={card.id} card={card} />
            ))}
            {/* Stated rather than silently dropped. The directory next door is the surface
                that paginates, and it is one click away. See `PIPELINE_COLUMN_CAP`. */}
            {column.total > column.cards.length ? (
              <p className="px-1 py-1 text-xs text-muted-foreground">
                {`Showing the first ${String(PIPELINE_COLUMN_CAP)} of ${String(column.total)}. Open Speakers CRM to filter the rest.`}
              </p>
            ) : null}
          </div>
        </ScrollArea>
      )}
    </section>
  )
}

function ContactCard({ card }: { card: PipelineCard }) {
  return (
    <Card className="gap-0 py-3">
      <CardContent className="flex flex-col gap-2 px-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* The profile behind this name is a dynamic route with no `loading.tsx` of its own
              (bodo-conventions.md: a boundary there turns its `notFound()` into a 200), so
              the click is followed by seconds of an unchanged board unless the name says
              otherwise. Same finding, same fix, as `ButtonLink`. */}
          <CrmPendingLink
            href={`/admin/crm/${card.id}`}
            className="flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
          >
            <span className="truncate">{card.name}</span>
          </CrmPendingLink>
          <span className="truncate text-xs text-muted-foreground">{card.subtitle}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* How many of the VIEWER's events, never the person's whole career. See
              `SpeakerInEvents` in types/crm.ts. */}
          <Badge variant="outline" className="tabular-nums">
            {card.eventCount === 1 ? '1 event' : `${String(card.eventCount)} events`}
          </Badge>
          {/* Absent for a reviewer, who may read the CRM and move nobody. A disabled menu
              would advertise a write that is not theirs and say nothing about why. */}
          {card.editableEventId === undefined ? null : (
            <SpeakerStageControl speakerId={card.id} stage={card.stage} size="xs" />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
