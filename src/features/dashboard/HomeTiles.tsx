// The two tile rows and the advisory strip from ref 34.
//
// Server components with no interactivity: every number is computed on the server by
// home-view.ts, so nothing here can render a different total than the page did.

import { AwardIcon, ChevronRightIcon, FileTextIcon, MicIcon, StoreIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { StatusChip } from '@/components/primitives/StatusChip'
import { Card, CardContent } from '@/components/ui/card'
import { SUBMISSION_STATUS_LABELS } from '@/constants/status'
import type { Advisory, StatusTile } from '@/features/dashboard/home-view'

/**
 * The four KPI tiles, in ref 34's order including the two that are always zero.
 *
 * Exhibitors and Sponsors are kept and read 0 rather than being dropped, and that is a
 * deliberate call worth stating: both areas are on the waived list in the parity report, so
 * bodo has no data for either. Ref 34 shows them at 0 on the reference event too, so the
 * row matches the capture, and an organizer's eye finds the Submissions tile in the place
 * it expects. They carry no link, because there is nothing to link to.
 */
export function KpiTiles({
  submissions,
  acceptedSpeakers,
}: {
  submissions: number
  acceptedSpeakers: number
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Submissions" icon={<FileTextIcon />} value={submissions} />
      <Tile label="Accepted Speakers" icon={<MicIcon />} value={acceptedSpeakers} />
      <Tile label="Exhibitors" icon={<StoreIcon />} value={0} />
      <Tile label="Sponsors" icon={<AwardIcon />} value={0} />
    </div>
  )
}

export function StatusTiles({ tiles }: { tiles: readonly StatusTile[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground">SUBMISSION STATUS</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <Card key={tile.status}>
            <CardContent className="flex flex-col gap-2">
              <StatusChip status={tile.status} />
              <p className="font-heading text-2xl font-semibold tabular-nums">{tile.count}</p>
              <p className="sr-only">{SUBMISSION_STATUS_LABELS[tile.status]}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

/**
 * The "Also check" strip: only what is actually true, each with the link that fixes it.
 *
 * Every entry is shown. There used to be a cap of two plus a `+N more` label, and that
 * label was a dead end: it is a plain `<span>` in a file that is deliberately server-only
 * and has no state to expand with, and no other surface lists these advisories, so the
 * third check was simply unreachable while looking exactly like the control that would
 * reveal it. The strip already wraps, so showing all of them costs a line of height and
 * nothing else, and it keeps this a server component rather than shipping JavaScript in
 * order to hide an alert.
 *
 * Nothing renders at all when the list is empty, rather than an empty labelled strip.
 */
export function AdvisoryStrip({ entries }: { entries: readonly Advisory[] }) {
  if (entries.length === 0) return null

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">Also check</span>
        {entries.map((entry) => (
          <span key={entry.id} className="inline-flex items-center gap-1">
            <span className="text-muted-foreground">{entry.text}</span>
            <Link
              href={entry.href}
              className="inline-flex items-center font-medium text-primary underline-offset-4 hover:underline"
            >
              ({entry.linkLabel})
              <ChevronRightIcon className="size-3.5" />
            </Link>
          </span>
        ))}
      </CardContent>
    </Card>
  )
}

function Tile({ label, icon, value }: { label: string; icon: ReactNode; value: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
          {icon}
          {label}
        </span>
        <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}
