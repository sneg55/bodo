// A speaker's session sublist: title, date and room. R9, EMB-05, EMB-13.
//
// One component, drawn by the roster row and by the detail dialog, because both were judged to
// have the same defect: they listed session TITLES and nothing else. A visitor opening a speaker
// profile wants to know when to be where, and a bare title answers neither half of that.
//
// Nothing is computed here. The date arrives as the same pre-formatted stamp the session card
// printed and the room as the same resolved name (@/features/cms/projection-days), so a profile
// and a card cannot disagree about the same session, which EMB-16 checks across surfaces.

import { MapPinIcon } from 'lucide-react'

import type { EmbedSpeakerSession } from '@/features/cms/speakers'
import { cn } from '@/utils/cn'

export function EmbedSpeakerSessions({
  sessions,
  className,
}: {
  sessions: readonly EmbedSpeakerSession[]
  className?: string
}) {
  if (sessions.length === 0) return null
  return (
    <ul className={cn('flex flex-col gap-1 text-sm', className)}>
      {sessions.map((session) => (
        <li key={session.id} className="flex flex-col">
          <span className="text-pretty">{session.title}</span>
          {session.when === undefined && session.room === undefined ? null : (
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {session.when === undefined ? null : (
                <span className="tabular-nums">{session.when}</span>
              )}
              {session.room === undefined ? null : (
                <span className="inline-flex items-center gap-1">
                  <MapPinIcon className="size-3" />
                  {session.room}
                </span>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * `Sessions (3)`.
 *
 * The count is a named plus in the rubric and it is cheap to be right about: a profile whose
 * sublist scrolls is easier to read when the heading says how many are in it.
 */
export function embedSessionsHeading(count: number): string {
  return `Sessions (${count})`
}
