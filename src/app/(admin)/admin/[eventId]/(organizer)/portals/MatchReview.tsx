'use client'

// Step 3 of Create Portal: who these filters actually catch, right now.
//
// Split out of ./CreatePortalWizard.tsx at its line budget. A real seam rather than a place
// to cut: everything left in that file is the wizard's own state and step plumbing, and this
// renders one step's body from props it is handed.
//
// The list is a `ScrollArea` with a DEFINITE height, and that is the whole of the fix this
// file was extracted during. See the note on the element.

import { ScrollPanel } from '@/components/primitives/ScrollPanel'
import { Badge } from '@/components/ui/badge'

import type { PortalPreviewContact } from './CreatePortalWizard'
import { CONTACT_TYPE_LABELS, labelOf } from './portal-filter-labels'

export function MatchReview({
  matched,
  total,
}: {
  matched: readonly PortalPreviewContact[]
  total: number
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="font-medium tabular-nums">{matched.length}</span>
        {` of ${String(total)} contacts on this event match these filters.`}
      </p>

      {matched.length === 0 ? (
        <p className="rounded-lg border border-dashed border-destructive/60 p-4 text-sm text-muted-foreground">
          Nobody matches yet. That is fine if the sessions these filters describe have not been
          accepted, and a mistake otherwise. The list screen keeps showing this count after the
          portal is created.
        </p>
      ) : (
        /* `ScrollPanel`, whose whole reason for existing is this list: a bare `max-h-72` on
           a `ScrollArea` never becomes a scroller, so the rows painted over the wizard's
           Cancel / Back / Continue footer, and nine contacts was enough to reach it. This
           shipped as a fixed `h-72` first, which fixed the overlap and left a 288px box
           around a two-contact match. The panel caps instead of fixing, so it hugs a short
           list and scrolls a long one. */
        <ScrollPanel className="max-h-72 rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {matched.map((entry) => (
              <li
                key={entry.contact.speakerId}
                className="flex flex-wrap items-center gap-2 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
                {entry.contact.company === undefined ? null : (
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.contact.company}
                  </span>
                )}
                {entry.contact.roles.map((role) => (
                  <Badge key={role} variant="outline">
                    {labelOf(CONTACT_TYPE_LABELS, role)}
                  </Badge>
                ))}
              </li>
            ))}
          </ul>
        </ScrollPanel>
      )}
    </div>
  )
}
