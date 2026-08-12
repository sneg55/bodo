// MailStatusChip: one outbox row's delivery state as a Badge.
//
// A sibling of StatusChip rather than a variant of it. `StatusChip` is typed to
// `SubmissionStatus` and its seven states are a submission's lifecycle; an outbox row's
// five are a different vocabulary on a different table, and widening that union would let
// `<StatusChip status="dead" />` compile on the Abstracts table, where it means nothing.
// The treatment is deliberately identical (same `cva` base string, same tokens), so the
// two read as one system on a surface that shows both.
//
// The labels come from `OUTBOX_STATUS_LABELS` in src/constants/status.ts. Nothing here
// restates them, for the reason StatusChipBadge gives about a second copy of an enum.
//
// On colour: the same five `--status-*` tokens the lifecycle chip uses, mapped by MEANING
// rather than by name. `queued` borrows pending because it is waiting; `sending` borrows
// queue because it is in flight; `sent` is accepted; and the two bad ends are both
// declined, separated the way `decline_queue` and `declined` already are: a transparent
// fill for the state a retry can still leave (`failed`), a filled one for the state
// nothing will change (`dead`). Nothing here picks a hex value.

import { cva } from 'class-variance-authority'

import { Badge } from '@/components/ui/badge'
import { OUTBOX_STATUS_LABELS, type OutboxStatus } from '@/constants/status'
import { cn } from '@/utils/cn'

/**
 * The same named transition the lifecycle chip carries, restated rather than imported
 * for the reason the base string is: importing from `StatusChipBadge` would pull that
 * module's lucide icon map into every bundle that shows an outbox row. See the comment
 * on `CHIP_TRANSITION` there for why the properties are named and why it is a
 * transition rather than a keyframe.
 */
const CHIP_TRANSITION =
  'transition-[color,background-color,border-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]'

export const mailStatusChipVariants = cva(
  `border font-mono text-[0.625rem] font-medium uppercase tracking-[0.07em] ${CHIP_TRANSITION}`,
  {
    variants: {
      status: {
        queued: 'border-status-pending/40 bg-status-pending/12 text-status-pending',
        sending: 'border-status-queue/45 bg-transparent text-status-queue',
        sent: 'border-status-accepted/40 bg-status-accepted/12 text-status-accepted',
        failed: 'border-status-declined/40 bg-transparent text-status-declined',
        dead: 'border-status-declined/40 bg-status-declined/12 text-status-declined',
      },
    },
    defaultVariants: { status: 'queued' },
  },
)

/**
 * A Map rather than a record lookup, matching StatusChipBadge: a computed index into a
 * plain object trips `security/detect-object-injection`, which fails the build.
 */
const MAIL_STATUS_LABELS: ReadonlyMap<OutboxStatus, string> = new Map(
  Object.entries(OUTBOX_STATUS_LABELS).map(([key, label]) => [key as OutboxStatus, label]),
)

export function mailStatusLabel(status: OutboxStatus): string {
  return MAIL_STATUS_LABELS.get(status) ?? status
}

export type MailStatusChipProps = {
  status: OutboxStatus
  className?: string
}

export function MailStatusChip({ status, className }: MailStatusChipProps) {
  return (
    <Badge variant="outline" className={cn(mailStatusChipVariants({ status }), className)}>
      {mailStatusLabel(status)}
    </Badge>
  )
}
