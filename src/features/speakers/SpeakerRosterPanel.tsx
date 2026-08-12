'use client'

// The organizer's speaker roster, with the edit sheet behind each row. SPK-01, SPK-02, CNT-10.
//
// PRESENTATION IS AUTHORED, NOT TRANSCRIBED. No screenshot of this surface exists in
// `sessionboard-refs/`, so there is no parity checklist for it and none was invented. The
// structure is borrowed from the captured admin lists next door: `Table` primitives as in
// `features/team/TeamTable.tsx`, and the same `Sheet`-behind-a-row shape the Add Abstract
// and Add File Request surfaces use.
//
// The list is patched from what the ACTION returned rather than from what was typed, the
// pattern `TeamPanel` and `LookupList` share. It matters here because the server trims every
// field: a name saved as `" Ada "` should leave the row reading what was stored.
//
// "CONFIRMED" MEANS THREE THINGS IN THIS ADMIN and this surface owns one of them, so it says
// which. Here it is `Speakers.status`, the organizer's own record of whether a person is
// coming, set on this roster and nowhere else. It is NOT the session decision, which is the
// accepted chip in the Submissions column beside it. And it is not the portal confirm task,
// which is what the dashboard's Speaker Tracking widget counts, so that widget can read
// "4 Confirmed" over a roster whose Confirmed tab reads 0 with neither being wrong. The tab
// strip and the status column are both labelled `Speaker status` for that reason.

import { PencilIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { SpeakerStatus } from '@/constants/status'
import { formatAgendaDate } from '@/features/agenda/time'
import { matchesEmbedQuery } from '@/features/cms/embed-browse'
import type { RosterSpeaker } from '@/features/speakers/admin-roster'
import { editableFromRoster, mergeIntoRoster } from '@/features/speakers/editable-speaker'
import { SpeakerEditSheet } from '@/features/speakers/SpeakerEditSheet'
import { SpeakerRosterToolbar } from '@/features/speakers/SpeakerRosterToolbar'
import { SpeakerStatusControl } from '@/features/speakers/SpeakerStatusControl'
import {
  SPEAKER_STATUS_HEADING,
  SpeakerStatusInfo,
  SpeakerStatusTabs,
} from '@/features/speakers/SpeakerStatusTabs'

export function SpeakerRosterPanel({
  eventId,
  speakers: initial,
}: {
  eventId: string
  speakers: readonly RosterSpeaker[]
}) {
  const [speakers, setSpeakers] = useState(initial)
  // Re-seeded when the SERVER hands down a different list, which is React's documented way
  // of adjusting state to a prop rather than an effect that runs a render late.
  //
  // Without it, `router.refresh()` was doing nothing visible. Add Speaker and Import CSV both
  // call it, the server re-rendered with the new roster, and this component kept the array it
  // was first mounted with: the new person appeared only after a full page load, which reads
  // exactly like a write that did not happen.
  const [seeded, setSeeded] = useState(initial)
  if (seeded !== initial) {
    setSeeded(initial)
    setSpeakers(initial)
  }
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<RosterSpeaker | undefined>(undefined)
  const [status, setStatus] = useState<SpeakerStatus | 'all'>('all')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [pending] = useTransition()
  const router = useRouter()

  // The same matcher the public embed search uses, so "okafor" and "José" behave the same on
  // both sides of the product. `speakers` there is a list of names; here it is the one name
  // plus the company, which is what an organizer scans a roster by.
  const shown = speakers
    .filter((speaker) => status === 'all' || speaker.status === status)
    .filter((speaker) =>
      matchesEmbedQuery(
        { title: speaker.name, speakers: [speaker.email], description: speaker.company },
        query,
      ),
    )

  // Counted over every speaker, not over what the search has narrowed to, so the tab labels
  // do not move while somebody types.
  const countOf = (value: SpeakerStatus) =>
    speakers.filter((speaker) => speaker.status === value).length

  // Intersected with what is VISIBLE, so a selection made on the All tab cannot quietly
  // invite people the organizer has since filtered away. Narrowing the list narrows what the
  // button will send to, which is the only reading of a filter that does not surprise anyone.
  const selectedShown = shown.filter((speaker) => selected.has(speaker.id))
  const allShownSelected = shown.length > 0 && selectedShown.length === shown.length

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SpeakerStatusTabs
        status={status}
        total={speakers.length}
        countOf={countOf}
        onChange={setStatus}
      />

      <SpeakerRosterToolbar
        eventId={eventId}
        query={query}
        onQueryChange={setQuery}
        selectedIds={selectedShown.map((speaker) => speaker.id)}
        onSent={() => setSelected(new Set())}
        onInvited={({ ids, invitedAt }) => {
          const stamped = new Set(ids)
          setSpeakers((current) =>
            current.map((row) => (stamped.has(row.id) ? { ...row, invitedAt } : row)),
          )
          setSelected(new Set())
        }}
        onRefresh={() => router.refresh()}
      />

      {shown.length === 0 ? (
        <p className="text-pretty text-sm text-muted-foreground">
          {speakers.length === 0
            ? 'No speakers yet. They are created when somebody submits, and by the Add Abstract form.'
            : 'No speakers match that search.'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allShownSelected}
                  aria-label="Select all speakers"
                  onCheckedChange={(checked) =>
                    // Over what is SHOWN, never over the whole roster: a select-all that
                    // reached past the filter is how eighty people get invited by accident.
                    setSelected(
                      checked === true ? new Set(shown.map((speaker) => speaker.id)) : new Set(),
                    )
                  }
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Company</TableHead>
              <TableHead className="w-36">
                {/* Named in full, and not `Status`: the row also carries a submission
                    status one column along, and the two answer different questions. */}
                <span className="flex items-center gap-1.5">
                  {SPEAKER_STATUS_HEADING}
                  <SpeakerStatusInfo />
                </span>
              </TableHead>
              <TableHead className="w-28">Invited</TableHead>
              <TableHead className="w-32">Submissions</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((speaker) => (
              <TableRow key={speaker.id}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(speaker.id)}
                    aria-label={`Select ${speaker.name}`}
                    onCheckedChange={(checked) => toggle(speaker.id, checked === true)}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <Avatar size="sm">
                      {speaker.headshotUrl === undefined ? null : (
                        <AvatarImage src={speaker.headshotUrl} alt={speaker.name} />
                      )}
                      <AvatarFallback>{speaker.initials}</AvatarFallback>
                    </Avatar>
                    {/* The name OPENS THE EDIT SHEET, the same thing the pencil at the end of
                        the row does. A name in a table of people is the first thing anybody
                        clicks, and until now it was inert: there is no organizer-side speaker
                        profile page for it to navigate to, so rather than leave the most
                        obvious target on the row doing nothing, it runs the row's own action.
                        A `Button`, not a `ButtonLink`, because it goes nowhere.
                        `plain-label`: the label IS the person's name. The mono-uppercase
                        button treatment is for machine labels, and it rendered this cell as
                        ADA OKAFOR in 11px mono while the Email and Company cells beside it
                        stayed in sans - a roster whose Name column shouted. */}
                    <Button
                      variant="link"
                      className="plain-label h-auto p-0 font-medium text-foreground"
                      onClick={() => setEditing(speaker)}
                    >
                      {speaker.name}
                    </Button>
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{speaker.email}</TableCell>
                <TableCell className="text-muted-foreground">{speaker.company ?? '-'}</TableCell>
                <TableCell>
                  {/* A control, not a chip. See SpeakerStatusControl.tsx: the chip that used
                      to be here looked pressable, was not, and was filed as a dead control. */}
                  <SpeakerStatusControl
                    eventId={eventId}
                    speakerId={speaker.id}
                    speakerName={speaker.name}
                    status={speaker.status}
                    onChanged={(next) =>
                      setSpeakers((current) =>
                        current.map((row) =>
                          row.id === speaker.id ? { ...row, status: next } : row,
                        ),
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  {/* The whole point of the column: an organizer working a roster imported
                      from a spreadsheet needs to see who has already been written to. Shown
                      as a UTC date rather than in the event's timezone, because the roster
                      does not carry one and a wrong zone on a sent-date is worse than a
                      plain one. */}
                  {speaker.invitedAt === undefined ? (
                    <span className="text-muted-foreground">Not invited</span>
                  ) : (
                    <Badge variant="secondary">
                      {formatAgendaDate(speaker.invitedAt.slice(0, 10))}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <span className="tabular-nums">{speaker.submissionCount}</span>
                    {/* Accepted is the fact an organizer is looking for on this row: it is
                        the difference between somebody who applied and somebody who is
                        speaking at the event. Named `Session accepted` rather than
                        `Accepted`, so the row says which of its two verdicts this is. */}
                    {speaker.hasAccepted ? (
                      <Badge variant="secondary">Session accepted</Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${speaker.name}`}
                    disabled={pending}
                    // Room on every side: it is the only control in a `w-12` cell, and the
                    // 4px it gains sideways stays inside that cell's own `p-2`. Row pitch is
                    // 49px, so the 40px area clears the rows above and below.
                    className="hit-area"
                    onClick={() => setEditing(speaker)}
                  >
                    <PencilIcon />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <SpeakerEditSheet
        eventId={eventId}
        speaker={editing === undefined ? undefined : editableFromRoster(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined)
        }}
        onSaved={(saved) => {
          // Patched in place rather than refetched: the write has already expired the tags,
          // but the table is looking at rows this component owns and a `refresh()` here
          // would blank the search and the tab for the sake of data already in hand.
          setSpeakers((current) =>
            current.map((row) => (row.id === saved.id ? mergeIntoRoster(row, saved) : row)),
          )
          setEditing(undefined)
          toast.success('Saved successfully')
        }}
      />
    </div>
  )
}
