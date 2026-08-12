// StatusChip: the seven-state submission lifecycle as a Badge.
//
// The vocabulary, the labels, and the legal moves all come from
// src/constants/status.ts. Nothing here redefines them, because a second copy of
// the enum is how a status ends up rendering as a blank chip that no filter
// matches. The inline lifecycle editor is StatusChipEditor, in its own file so
// this stays server-renderable.
//
// On colour: the parity audit pins Accepted green and Pending orange, and the
// hues used to be written here as literal Tailwind classes because the theme had
// no token that meant them. It does now. `--status-*` in globals.css carries one
// value per lifecycle meaning and is defined in both themes, so a variant names a
// meaning and the palette layer decides what that looks like. Nothing here picks
// a colour.

import { cva } from 'class-variance-authority'
import {
  CircleCheckIcon,
  CircleIcon,
  CircleSlashIcon,
  CircleXIcon,
  ClockIcon,
  PenLineIcon,
  ThumbsDownIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { SUBMISSION_STATUS_LABELS, type SubmissionStatus } from '@/constants/status'
import { cn } from '@/utils/cn'

/**
 * A CSS TRANSITION and never a keyframe, and the three properties are named rather
 * than left as the `transition-all` the Badge base carries.
 *
 * Both halves matter. A status is reassigned in place from the inline editor, so the
 * organizer can pick Accepted and then Declined before the first change has finished
 * drawing: a transition retargets from wherever the colour currently is, where a
 * keyframe would restart from the old colour every time. And the properties are named
 * because `transition-all` on a chip whose padding, border-radius and layout are all
 * variant-driven means the browser watches every one of them for a change that is only
 * ever a colour. Listed here rather than fixed in `ui/badge.tsx`, which is generated
 * and must not carry project styling; `cn` merges this over the base.
 */
const CHIP_TRANSITION =
  'transition-[color,background-color,border-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]'

export const statusChipVariants = cva(
  `border font-mono text-[0.625rem] font-medium uppercase tracking-[0.07em] ${CHIP_TRANSITION}`,
  {
    variants: {
      status: {
        draft: 'border-border bg-secondary text-status-neutral',
        pending: 'border-status-pending/40 bg-status-pending/12 text-status-pending',
        accept_queue: 'border-status-queue/45 bg-transparent text-status-queue',
        decline_queue: 'border-status-declined/40 bg-transparent text-status-declined',
        accepted: 'border-status-accepted/40 bg-status-accepted/12 text-status-accepted',
        declined: 'border-status-declined/40 bg-status-declined/12 text-status-declined',
        withdrawn: 'border-border bg-muted text-status-neutral',
      },
    },
    defaultVariants: { status: 'pending' },
  },
)

/**
 * Maps rather than record lookups: `security/detect-object-injection` flags a
 * computed index into a plain object, and that warning fails the build. The icon
 * map holds finished elements rather than components, because pulling a component
 * out of a lookup during render trips `react-hooks/static-components`.
 */
const STATUS_LABELS: ReadonlyMap<SubmissionStatus, string> = new Map(
  Object.entries(SUBMISSION_STATUS_LABELS).map(([key, label]) => [key as SubmissionStatus, label]),
)

const STATUS_ICONS: ReadonlyMap<SubmissionStatus, ReactNode> = new Map([
  ['draft', <PenLineIcon key="draft" data-icon="inline-start" />],
  ['pending', <CircleIcon key="pending" data-icon="inline-start" />],
  ['accept_queue', <ClockIcon key="accept_queue" data-icon="inline-start" />],
  ['decline_queue', <ThumbsDownIcon key="decline_queue" data-icon="inline-start" />],
  ['accepted', <CircleCheckIcon key="accepted" data-icon="inline-start" />],
  ['declined', <CircleXIcon key="declined" data-icon="inline-start" />],
  ['withdrawn', <CircleSlashIcon key="withdrawn" data-icon="inline-start" />],
])

export function submissionStatusLabel(status: SubmissionStatus): string {
  return STATUS_LABELS.get(status) ?? status
}

export type StatusChipProps = {
  status: SubmissionStatus
  /**
   * The portal cards show an icon with the chip ("Accepted green check, Pending
   * orange circle"); the Abstracts table shows the chip alone. Off by default so
   * the dense surface stays dense.
   */
  withIcon?: boolean
  className?: string
}

export function StatusChip({ status, withIcon = false, className }: StatusChipProps) {
  return (
    <Badge variant="outline" className={cn(statusChipVariants({ status }), className)}>
      {withIcon ? STATUS_ICONS.get(status) : null}
      {submissionStatusLabel(status)}
    </Badge>
  )
}
