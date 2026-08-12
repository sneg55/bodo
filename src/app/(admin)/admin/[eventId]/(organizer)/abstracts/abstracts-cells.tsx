'use client'

// Cell renderers for the Abstracts table.
//
// The DataTable primitive is generic over the row and takes one renderer per column, so
// this is the only file that knows what an abstract looks like on screen. Column
// identity, labels, and the info tooltips all come from the field registry through the
// primitive; nothing here re-labels a column, with one sanctioned exception (Ratings,
// which is named after the evaluation plan, and the two participant columns the registry
// has no per-submission entry for).

import Link from 'next/link'

import {
  type DataTableCatalog,
  type DataTableColumn,
  SESSION_CATALOG,
} from '@/components/primitives/data-table-types'
import { StatusChip } from '@/components/primitives/StatusChipBadge'
import { StatusChipEditor } from '@/components/primitives/StatusChipEditor'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DEFAULT_COLUMN_KEYS, type RegistryField, SESSION_FIELDS } from '@/constants/fields'
import type { SubmissionStatus } from '@/constants/status'
import { type AbstractChip, type AbstractRow, EMPTY_CELL } from '@/features/review/abstracts-rows'
import { RATING_HELP, RATING_PLACEHOLDER, type RatingCell } from '@/features/review/ratings'
import {
  sessionFormatLabel,
  sessionLanguageLabel,
  sessionLevelLabel,
} from '@/features/submissions/session-vocabulary'

function Text({ value, className }: { value: string | undefined; className?: string }) {
  const text = value ?? ''
  if (text.length === 0) return <span className="text-muted-foreground">{EMPTY_CELL}</span>
  return <span className={className}>{text}</span>
}

function NumberCell({ value }: { value: number | undefined }) {
  return <Text value={value === undefined ? '' : String(value)} className="tabular-nums" />
}

/**
 * A track or tag chip. The colour is event data, not a theme decision, so it is applied
 * as a dot rather than as the chip's own text and border: an organizer can pick any hex
 * value and a low-contrast one would make the label unreadable in one of the two themes.
 * The dot carries the identity, the tokens carry the legibility.
 */
function ChipCell({ chip }: { chip: AbstractChip }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: chip.color }}
      />
      {chip.name}
    </Badge>
  )
}

/**
 * Three states, never collapsed into one. A percent is a real weighted mean; "-" means
 * review was expected and has not happened; "n/a" means this row was never sent for
 * review. `scoring.ts` returns `undefined` rather than 0 precisely so this distinction
 * survives, and both placeholders carry a tooltip saying which one it is.
 */
function RatingCellView({ rating }: { rating: RatingCell }) {
  if (rating.kind === 'scored') {
    return (
      <Tooltip>
        <TooltipTrigger className="inline-flex items-baseline gap-1 tabular-nums">
          <span className="font-medium">{rating.percent}%</span>
          <span className="text-xs text-muted-foreground">({rating.reviewCount})</span>
        </TooltipTrigger>
        <TooltipContent>
          Weighted average across {rating.reviewCount}{' '}
          {rating.reviewCount === 1 ? 'review' : 'reviews'}. Yes {rating.recommendations.yes}, maybe{' '}
          {rating.recommendations.maybe}, no {rating.recommendations.no}.
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger className="text-muted-foreground">
        {rating.kind === 'none' ? RATING_PLACEHOLDER.none : RATING_PLACEHOLDER.not_required}
      </TooltipTrigger>
      <TooltipContent>
        {rating.kind === 'none' ? RATING_HELP.none : RATING_HELP.not_required}
      </TooltipContent>
    </Tooltip>
  )
}

export type AbstractColumnOptions = {
  readonly ratingsLabel: string
  /** Only an admin may change a status. A reviewer sees a read-only chip. */
  readonly canEditStatus: boolean
  /** Scopes the title's link to the detail route. */
  readonly eventId: string
  readonly onStatusChange: (row: AbstractRow, next: SubmissionStatus) => void
}

export function abstractColumns({
  ratingsLabel,
  canEditStatus,
  eventId,
  onStatusChange,
}: AbstractColumnOptions): readonly DataTableColumn<AbstractRow>[] {
  return [
    { key: 'code', cell: (row) => <Text value={row.code} className="tabular-nums" /> },
    {
      // The title is a LINK, and until it was one there was no way to open a submission at
      // all: a click select-copied the text and the status cell opened a popover, so the
      // record itself had no route in. Every other cell here is a control or a bare value,
      // which makes the title the only honest place for the affordance and the first place
      // anyone tries.
      key: 'title',
      cell: (row) => (
        <Link
          href={`/admin/${eventId}/abstracts/${row.id}`}
          className="font-medium hover:underline"
        >
          {row.title}
        </Link>
      ),
      cellClassName: 'max-w-72 truncate',
    },
    {
      key: 'status',
      cell: (row) =>
        canEditStatus ? (
          <StatusChipEditor
            status={row.status}
            onChange={(next) => {
              // `null` is the popover's Clear control. A submission always has a place
              // in the lifecycle, so clearing is treated as no change rather than as a
              // write of an empty status the schema has no value for.
              if (next !== null) onStatusChange(row, next)
            }}
          />
        ) : (
          <StatusChip status={row.status} />
        ),
    },
    {
      key: 'source',
      cell: (row) => (
        <Badge variant="secondary" className="max-w-40 truncate">
          {row.sourceLabel}
        </Badge>
      ),
    },
    {
      key: 'description',
      cell: (row) => <Text value={row.description} />,
      cellClassName: 'max-w-80 truncate text-muted-foreground',
    },
    // The three single-select columns render their LABEL, not the value the record
    // holds. Airtable will not accept a choice outside the declared vocabulary, so
    // `Submissions.format` stores `talk` and can store nothing else (see
    // `session-vocabulary.ts`); printing that verbatim is why the CFP-06 evaluation
    // read `talk` in this column while the speaker's own answers said `Talk (30 min)`.
    // The row keeps the stored value, so sort, filter and the CSV export are untouched.
    { key: 'format', cell: (row) => <Text value={sessionFormatLabel(row.format)} /> },
    { key: 'level', cell: (row) => <Text value={sessionLevelLabel(row.level)} /> },
    { key: 'language', cell: (row) => <Text value={sessionLanguageLabel(row.language)} /> },
    {
      key: 'track',
      cell: (row) => (row.track === undefined ? <Text value="" /> : <ChipCell chip={row.track} />),
    },
    {
      key: 'tags',
      cell: (row) =>
        row.tags.length === 0 ? (
          <Text value="" />
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.tags.map((tag) => (
              <ChipCell key={tag.id} chip={tag} />
            ))}
          </span>
        ),
    },
    { key: 'ceuCredits', cell: (row) => <NumberCell value={row.ceuCredits} /> },
    { key: 'startsAt', cell: (row) => <Text value={row.dates.startsAt} /> },
    { key: 'endsAt', cell: (row) => <Text value={row.dates.endsAt} /> },
    { key: 'room', cell: (row) => <Text value={row.roomName} /> },
    { key: 'scheduleStatus', cell: (row) => <Text value={row.scheduleStatus} /> },
    { key: 'capacity', cell: (row) => <NumberCell value={row.capacity} /> },
    { key: 'location', cell: (row) => <Text value={row.location} /> },
    { key: 'clientSessionId', cell: (row) => <Text value={row.clientSessionId} /> },
    {
      key: 'chairperson',
      cell: (row) => <Text value={row.chairpersons.join(', ')} />,
      cellClassName: 'max-w-56 truncate',
    },
    { key: 'notifiedAt', cell: (row) => <Text value={row.dates.notifiedAt} /> },
    { key: 'submittedAt', cell: (row) => <Text value={row.dates.submittedAt} /> },
    { key: 'ratings', label: ratingsLabel, cell: (row) => <RatingCellView rating={row.rating} /> },
    // These two carry no `label` or `help` of their own: they are declared in
    // ABSTRACTS_CATALOG below, so the label, the tooltip and the Columns picker entry all
    // come from one place, the way every other column's do.
    {
      key: 'submitter',
      cell: (row) => <Text value={row.submitterEmail} />,
      cellClassName: 'max-w-56 truncate',
    },
    {
      key: 'speakers',
      cell: (row) =>
        row.speakers.length === 0 ? (
          <Text value="" />
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.speakers.map((name) => (
              <Badge key={name} variant="outline">
                {name}
              </Badge>
            ))}
          </span>
        ),
    },
  ]
}

/**
 * The columns the table opens with: the registry's own default set, plus the two
 * participant columns the audit shows in the default view. The registry stays the source
 * of the set (`DEFAULT_COLUMN_KEYS`), which is why these are appended rather than a list
 * written out by hand here.
 */
export const EXTRA_DEFAULT_COLUMN_KEYS: readonly string[] = ['submitter', 'speakers']

/**
 * The two participant columns, as catalog fields.
 *
 * The registry has no entry for either, and should not: its participant fields describe
 * one person's questions, while these describe a submission's cast. They were column-level
 * `label` and `help` overrides instead, which put the header right and left everything
 * else wrong. The Columns picker is built from `catalog.fields`, so neither appeared in the
 * left-hand Fields list and removing one was permanent; the Selected pane falls back to the
 * raw key, so the two chips read `submitter` and `speakers` in lower case beside a column
 * of Title Case labels.
 *
 * `column: false` because there is no Submissions column behind either: the submitter is a
 * link and the speakers are the participant rows. That flag describes the Airtable schema
 * and nothing on this surface reads it, because Sort and Filter are offered from
 * `SORTABLE_ROW_KEYS` instead, and `rowText` answers both keys already
 * (abstracts-accessors.ts). So both are genuinely sortable and filterable here, and
 * offering them is not a control that does nothing.
 *
 * The help copy is AUTHORED, carried over verbatim from the column overrides it replaces:
 * the reference captured the info icon on every header but never the tooltip behind it.
 */
const PARTICIPANT_COLUMN_FIELDS: readonly RegistryField[] = [
  {
    key: 'submitter',
    label: 'Session Submitter',
    type: 'email',
    group: 'participant',
    column: false,
    defaultVisible: true,
    help: 'The person who sent this in: the primary participant on the submission.',
  },
  {
    key: 'speakers',
    label: 'Speaker',
    type: 'text',
    group: 'participant',
    column: false,
    defaultVisible: true,
    help: 'Everyone presenting this session, in the order the submission lists them.',
  },
]

/**
 * The SUBMISSIONS surfaces' column catalog: the shared submission catalog plus the two
 * columns above.
 *
 * Local to this call site rather than folded into `SESSION_CATALOG`, which is the default
 * for every other table on the primitive (Files, Agenda List, the sync log, the portal
 * content lists). Those tables have no submitter or speakers accessor, so two fields they
 * cannot render would appear in their Columns pickers.
 *
 * `defaultColumnKeys` is the set this table actually opens with, which is what makes
 * "Reset to Default" restore the view an organizer started from. It used to be the
 * registry's set alone, so a reset silently dropped the same two columns.
 */
export const ABSTRACTS_CATALOG: DataTableCatalog = {
  ...SESSION_CATALOG,
  fields: [...SESSION_FIELDS, ...PARTICIPANT_COLUMN_FIELDS],
  defaultColumnKeys: [...DEFAULT_COLUMN_KEYS, ...EXTRA_DEFAULT_COLUMN_KEYS],
}
