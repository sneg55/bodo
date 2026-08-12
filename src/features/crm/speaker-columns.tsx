'use client'

// Cell renderers for the CRM directory.
//
// One renderer per key in `SPEAKER_CRM_FIELDS`, and that correspondence is the contract:
// the Columns picker offers the catalog, and `DataTable` silently drops a checked key it
// has no renderer for, so a field here without a cell is a checkbox that does nothing.
//
// Nothing re-labels a column. Labels and the info tooltips come from the catalog through
// the primitive (`DataTableGrid`), which is why this file passes no `label` or `help`.

import { CopyIcon } from 'lucide-react'
import Link from 'next/link'

import type { DataTableColumn } from '@/components/primitives/data-table-types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DuplicateReason } from '@/features/crm/duplicates'
import {
  type SpeakerRow,
  speakerInitials,
  speakerName,
  speakerText,
} from '@/features/crm/speaker-rows'

/** The empty-cell rendering the parity audit records. A hyphen, not a dash. */
const EMPTY_CELL = '-'

/** How much biography a cell shows. A column width, not a property of the value, which is
 * why the truncation lives here and the accessor a filter reads keeps the whole text. */
const BIO_LIMIT = 160

function truncate(value: string | undefined, limit: number): string | undefined {
  if (value === undefined || value.length <= limit) return value
  return `${value.slice(0, limit)}...`
}

function Text({ value, className }: { value: string | undefined; className?: string }) {
  const text = value ?? ''
  if (text.length === 0) return <span className="text-muted-foreground">{EMPTY_CELL}</span>
  return <span className={className}>{text}</span>
}

/** Counts are read down a column, so they are tabular and right-aligned. */
function CountCell({ value }: { value: number }) {
  return <span className="tabular-nums">{value}</span>
}

/**
 * The Name cell, and the row's only link.
 *
 * One link per row rather than a whole-row click target: a row carries an email address
 * and a biography that an organizer wants to select and copy, and a clickable row makes
 * selecting text inside it navigate away.
 */
function NameCell({ row, duplicate }: { row: SpeakerRow; duplicate: DuplicateReason | undefined }) {
  return (
    <span className="flex items-center gap-2">
      <Link
        href={`/admin/crm/${row.speaker.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        {speakerName(row.speaker)}
      </Link>
      {duplicate === undefined ? null : <DuplicateBadge reason={duplicate} />}
    </span>
  )
}

/**
 * The badge the audit found missing: a record that looks like another record says so on the
 * row, not only inside a review screen the organizer has to know exists.
 *
 * Two wordings rather than one, because the two relations differ in certainty and the merge
 * they lead to is irreversible. A shared email is a fact about the data; a shared name is a
 * guess, and `Possible duplicate` is the honest label for it.
 *
 * A `Tooltip` and not a `title` attribute: a native tooltip is an ESLint error here, and it
 * would not be reachable from the keyboard either.
 */
function DuplicateBadge({ reason }: { reason: DuplicateReason }) {
  const isEmail = reason === 'email'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // A bare trigger rather than a `Button`, so nothing gave it a target: the chip is
          // 20px tall. 28px is the ceiling, not 40, because the table row is the pitch and
          // the density control can set it to `py-1`: 4 + 20 + 4 = 28, so two flagged rows
          // stacked have their areas meet exactly. `hit-area-[28px]` and not `hit-area-y`
          // because the square stays inside the chip's width, which keeps it off the row's
          // name link sitting `gap-2` to the left.
          // `overflow-visible` is what lets any of it apply: `Badge` clips descendants, and
          // nothing in a `w-fit` chip overflows, so the clip was inert.
          <Badge
            variant={isEmail ? 'destructive' : 'secondary'}
            className="overflow-visible hit-area-[28px]"
          >
            <CopyIcon aria-hidden />
            {isEmail ? 'Duplicate email' : 'Possible duplicate'}
          </Badge>
        }
      />
      <TooltipContent>
        {reason === 'email'
          ? 'Another record shares this email address.'
          : 'Another record shares this name. Check the details before merging.'}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * A CRM tag chip. The colour is organizer data rather than a theme decision, so it lands
 * as a dot and the label keeps the theme tokens: a tag can be any hex value, and one of
 * them would be unreadable in one of the two themes. The same treatment `ChipCell` gives
 * a track on the Abstracts table.
 */
function TagCell({ row }: { row: SpeakerRow }) {
  if (row.tags.length === 0) return <Text value="" />
  return (
    <span className="flex flex-wrap gap-1">
      {row.tags.map((tag) => (
        <Badge key={tag.id} variant="outline" className="gap-1.5">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
        </Badge>
      ))}
    </span>
  )
}

/**
 * The directory's columns.
 *
 * A function rather than a constant to match `abstractColumns` and to leave room for the
 * options later surfaces will need (a row action, for one). The Name cell is the row's
 * link into the profile at `/admin/crm/[speakerId]`.
 *
 * `duplicates` is speaker id to the reason its row is flagged, computed over the whole scope
 * by `loadCrmDirectory`. Optional so a caller with no duplicate analysis (a test, or a future
 * surface reusing these renderers) gets the plain table rather than having to pass an empty
 * map, and the badge is simply absent for a row the map says nothing about.
 */
export function speakerColumns(
  duplicates?: ReadonlyMap<string, DuplicateReason>,
): readonly DataTableColumn<SpeakerRow>[] {
  return [
    {
      key: 'name',
      cell: (row) => <NameCell row={row} duplicate={duplicates?.get(row.speaker.id)} />,
    },
    { key: 'firstName', cell: (row) => <Text value={row.speaker.firstName} /> },
    { key: 'lastName', cell: (row) => <Text value={row.speaker.lastName} /> },
    { key: 'email', cell: (row) => <Text value={row.speaker.email} /> },
    { key: 'phone', cell: (row) => <Text value={row.speaker.phone} /> },
    { key: 'bio', cell: (row) => <Text value={truncate(speakerText(row, 'bio'), BIO_LIMIT)} /> },
    { key: 'company', cell: (row) => <Text value={row.speaker.company} /> },
    {
      key: 'headshot',
      cell: (row) => (
        <Avatar className="size-7">
          <AvatarImage src={row.speaker.headshotUrl} alt="" />
          <AvatarFallback className="text-xs">{speakerInitials(row.speaker)}</AvatarFallback>
        </Avatar>
      ),
    },
    { key: 'tagline', cell: (row) => <Text value={row.speaker.tagline} /> },
    { key: 'pronouns', cell: (row) => <Text value={row.speaker.pronouns} /> },
    { key: 'tags', cell: (row) => <TagCell row={row} /> },
    { key: 'eventCount', cell: (row) => <CountCell value={row.eventCount} /> },
    { key: 'sessionCount', cell: (row) => <CountCell value={row.sessionCount} /> },
  ]
}
