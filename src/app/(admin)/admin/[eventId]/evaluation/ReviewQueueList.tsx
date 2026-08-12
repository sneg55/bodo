'use client'

// The reviewer's queue for the active round: what to score, and what is already scored.
//
// Split out of EvaluationPanel.tsx when that file passed the size limit. It is a
// presentation component and owns no state: which item is selected and what a click does
// both live in the URL, which the panel manages.

import { CheckIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { QueueItem } from '@/features/review/evaluation-view'
import { cn } from '@/utils/cn'

export function ReviewQueueList({
  queue,
  selectedId,
  onSelect,
}: {
  queue: readonly QueueItem[]
  selectedId?: string
  onSelect: (submissionId: string) => void
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Your queue ({queue.length})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing assigned to you in this round.</p>
        ) : null}
        {queue.map((item) => (
          <Button
            key={item.submissionId}
            variant={item.submissionId === selectedId ? 'secondary' : 'ghost'}
            className="h-auto justify-start py-1.5 text-left whitespace-normal"
            onClick={() => {
              onSelect(item.submissionId)
            }}
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-xs tabular-nums text-muted-foreground">
                {item.code}
                {item.trackName === undefined ? '' : ` · ${item.trackName}`}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                {/* A per-item mark, not just dimmed text. Dimming was the only signal that
                    an item had been scored, which is invisible on the selected row and
                    unreadable to anyone not comparing two rows at once. The only other
                    indicator was the round-level "9 of 40", which does not say which nine. */}
                {item.reviewed ? (
                  <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : null}
                <span className={cn('truncate', item.reviewed && 'text-muted-foreground')}>
                  {item.title}
                </span>
              </span>
              {/* Absent entirely on an anonymised round: the names never leave the server,
                  so there is nothing here to reveal. */}
              {item.authors === undefined ? null : (
                <span className="truncate text-xs text-muted-foreground">{item.authors}</span>
              )}
            </span>
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}
