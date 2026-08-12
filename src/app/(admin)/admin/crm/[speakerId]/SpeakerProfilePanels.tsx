'use client'

// The profile's Events and Sessions and Communication panels, plus the one field renderer
// the Details panel shares with them.
//
// Split out of `SpeakerProfile.tsx` when the Speaker Tags card became an editor: that file
// was at 298 lines with three panels inlined and the tag editor's wiring took it past the
// budget. The split is along the tab boundary, which is where it was always going to be:
// the two panels here are read-only lists and share nothing with Details but `Field`.
//
// COPY IS AUTHORED, as it is in the parent, for the same reason: the parity report waives
// the whole CRM area, so there is nothing to transcribe.

import { MailStatusChip } from '@/components/primitives/MailStatusChip'
import { StatusChip } from '@/components/primitives/StatusChip'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { PARTICIPANT_ROLE_LABELS, type ParticipantRole } from '@/constants/status'
import type { ProfileEvent } from '@/features/crm/profile'
import type { TimelineRow } from '@/features/crm/timeline'

/** The empty-cell rendering the parity audit records. A hyphen, not a dash. */
const EMPTY = '-'

/**
 * A Map rather than a record lookup, the same shape the CFP wizard's role controls use:
 * a computed index into a plain object trips `security/detect-object-injection`, which
 * fails the build.
 */
const ROLE_LABELS: ReadonlyMap<ParticipantRole, string> = new Map(
  Object.entries(PARTICIPANT_ROLE_LABELS).map(([role, label]) => [role as ParticipantRole, label]),
)

export function SessionsTab({ events }: { events: readonly ProfileEvent[] }) {
  if (events.length === 0) {
    // Unreachable through the directory, since a speaker with no event in scope is a 404,
    // but stated rather than rendered as an empty page.
    return <p className="text-sm text-muted-foreground">Not on any of your events.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {events.map((event) => (
        <Card key={event.id}>
          <CardHeader>
            <CardTitle>{event.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-0">
            {event.sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions on this event.</p>
            ) : (
              event.sessions.map((session, index) => (
                <div key={session.id}>
                  {index === 0 ? null : <Separator className="my-3" />}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {session.title}
                    </span>
                    {session.roles.map((role) => (
                      <Badge key={role} variant="secondary">
                        {ROLE_LABELS.get(role) ?? role}
                      </Badge>
                    ))}
                    <StatusChip status={session.status} />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/**
 * The one line under each subject: the event's name, when the mail was DUE, and when it
 * actually went if that was a different minute.
 *
 * `Scheduled` is a label and not decoration. The timestamp is `sendAt` (`crm/timeline.ts`),
 * which is when the mail was due to go out, and the list is ordered on it deliberately: a
 * queued row has no `sentAt` at all, so ordering on whichever of the two exists would sort a
 * message queued for next Tuesday above one that went out this morning. An unlabelled
 * schedule reads as a send time, though, so the label says which it is and `Sent` appears
 * beside it whenever the two differ. They usually do not: most mail is enqueued with
 * `sendAt: now` and drains within the minute, and `timelineRows` drops the second half when
 * it would render the same string twice.
 *
 * Every part is optional in practice and the join has to survive any of them missing. It
 * filtered only `undefined` before, which missed the other half: `dateTimeText` returns the
 * EMPTY STRING for a value the runtime cannot parse (see its doc), so a row with an
 * unreadable `sendAt` rendered as `Bodocon · ` with a separator hanging off the end. An
 * empty string is not a part, so it is dropped like an absent one, and a row with neither
 * renders nothing at all rather than a bare dot.
 */
function metaLine(row: TimelineRow): string {
  return [
    row.eventName,
    row.atText === '' ? undefined : `Scheduled ${row.atText}`,
    row.sentAtText === undefined ? undefined : `Sent ${row.sentAtText}`,
  ]
    .filter((part) => part !== undefined && part.length > 0)
    .join(' · ')
}

/**
 * The communication log. Read-only on purpose: there is no send control here, because
 * mail is triggered by a decision, a task or a form, and a free-text send from a CRM
 * profile would be a message no template and no outbox row explains.
 */
export function CommunicationTab({ timeline }: { timeline: readonly TimelineRow[] }) {
  if (timeline.length === 0) {
    return <p className="text-sm text-muted-foreground">No email sent to this speaker yet.</p>
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-0">
        {timeline.map((row, index) => {
          const meta = metaLine(row)
          return (
            <div key={row.id}>
              {index === 0 ? null : <Separator className="my-3" />}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.subject}</span>
                <MailStatusChip status={row.status} />
              </div>
              {meta.length === 0 ? null : <p className="text-xs text-muted-foreground">{meta}</p>}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

export function Field({ label, value }: { label: string; value?: string }) {
  const text = value ?? ''
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {text.length === 0 ? (
        <span className="text-sm text-muted-foreground">{EMPTY}</span>
      ) : (
        <span className="truncate text-sm">{text}</span>
      )}
    </div>
  )
}
