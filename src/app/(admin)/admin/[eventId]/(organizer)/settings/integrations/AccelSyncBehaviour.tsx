// The sync-behaviour rows on the Connection card.
//
// The three labels are the vendor's, verbatim: `Continuous Sync`, `Sync Moderators`,
// `Sync Chairpersons` are Sessionboard's per-event mapping toggles
// (docs/parity/external-references.md).
//
// They are READ ONLY, because none of them has a per-event column behind it in this schema.
// A switch that flips and forgets is worse than one that is honest about being a status
// light: the organizer would come away believing they had turned something off. So the
// group says once, above all three, that it is describing rather than offering.
//
// Split out of AccelConnectionCard because the detail behind each row is a paragraph, and
// three paragraphs stacked turned the card into prose nobody reads. The paragraph moved into
// the row's tooltip and the row now carries two words. Every note is checked against the
// code rather than assumed: the hourly cron in wrangler.jsonc is routed to
// `/api/cron/accelevents` by CRON_ROUTES in src/entrypoints/worker.ts, and the forward walk
// sends every participant cast in an accepted submission without reading their role
// (`castOf` in services/accelevents/sync.ts).

import { InfoIcon } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/utils/cn'

type BehaviourRow = {
  readonly id: string
  readonly label: string
  /** Two or three words. The whole row has to stay scannable at a glance. */
  readonly value: string
  readonly note: string
}

const ROWS: readonly BehaviourRow[] = [
  {
    id: 'continuous-sync',
    label: 'Continuous Sync',
    value: 'Hourly, at :17',
    note: 'Runs through /api/cron/accelevents. That sweep retries failed attempts; it does not re-walk the whole event, which is what Sync now does.',
  },
  {
    id: 'sync-moderators',
    label: 'Sync Moderators',
    value: 'Included',
    note: 'The walk sends every participant cast in an accepted session without reading their role, so moderators go with it.',
  },
  {
    id: 'sync-chairpersons',
    label: 'Sync Chairpersons',
    value: 'Included',
    note: 'Same reason as Moderators. Both are roles in DEFAULT_PARTICIPANT_ROLES and neither is filtered out.',
  },
]

export function AccelSyncBehaviour() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h5 className="text-sm font-medium">Sync behaviour</h5>
        <p className="text-xs text-muted-foreground">How the push runs. Not per-event settings.</p>
      </div>

      <div className="rounded-lg border border-border/70">
        {ROWS.map((row, index) => (
          <div
            key={row.id}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5',
              index > 0 && 'border-t border-border/70',
            )}
          >
            <Switch id={row.id} checked disabled className="shrink-0" />
            <Label htmlFor={row.id} className="min-w-0 flex-1 font-normal">
              {row.label}
            </Label>
            <span className="shrink-0 text-xs text-muted-foreground">{row.value}</span>
            <Tooltip>
              <TooltipTrigger className="shrink-0 text-muted-foreground">
                <InfoIcon className="size-3.5" />
                <span className="sr-only">About {row.label}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">{row.note}</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  )
}
