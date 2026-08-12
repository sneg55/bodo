'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripHorizontalIcon } from 'lucide-react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/utils/cn'
import { ConflictBadge } from '../ConflictBadge'
import type { ConflictReport } from '../conflicts'
import type { AgendaSession } from '../types'
import { moveId, resizeId } from './timeline-model'

export function AgendaDndCard({
  session,
  report,
  disabled,
  resize,
  focused = false,
  className,
  gridStyle,
}: {
  session: AgendaSession
  report: ConflictReport
  disabled: boolean
  resize: boolean
  /** The session the organizer came here to see, arriving from the Conflicts tab. */
  focused?: boolean
  className?: string
  gridStyle?: CSSProperties
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: moveId(session.id),
    disabled,
  })
  const style = { ...gridStyle, transform: CSS.Translate.toString(transform) }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('touch-none', isDragging && 'z-30 opacity-70', className)}
      {...attributes}
      {...(listeners ?? {})}
    >
      <Card
        size="sm"
        className={cn(
          'h-full gap-1 bg-card py-2 shadow-sm ring-foreground/15',
          focused && 'ring-2 ring-primary',
        )}
      >
        <CardContent className="relative flex min-h-0 flex-col gap-1 px-2">
          <div className="flex min-w-0 items-start justify-between gap-1">
            <p className="line-clamp-2 text-xs leading-tight font-medium">{session.title}</p>
            <ConflictBadge count={report.bySession.get(session.id)?.length ?? 0} compact />
          </div>
          <p className="truncate text-[0.6875rem] text-muted-foreground">
            {session.participants.map((participant) => participant.name).join(', ')}
          </p>
          {resize ? (
            <ResizeHandle sessionId={session.id} sessionTitle={session.title} disabled={disabled} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function ResizeHandle({
  sessionId,
  sessionTitle,
  disabled,
}: {
  sessionId: string
  sessionTitle: string
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: resizeId(sessionId),
    disabled,
  })
  const pointerDown = listeners?.onPointerDown

  return (
    <Button
      ref={setNodeRef}
      variant="ghost"
      size="icon"
      className="absolute right-0 bottom-0 size-10 cursor-ns-resize touch-none rounded-md"
      {...attributes}
      {...(listeners ?? {})}
      onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        pointerDown?.(event)
      }}
    >
      <GripHorizontalIcon />
      <span className="sr-only">Resize {sessionTitle}</span>
    </Button>
  )
}
