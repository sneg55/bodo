'use client'

// The Needs-email list. BUILD_SPEC 5.0e: "That screen is the deliverable, not a footnote."
//
// WHY IT EXISTS, stated on the screen and not only here. Sessionize's public speaker object
// is `id`, `firstName`, `lastName`, `fullName`, `bio`, `tagLine`, `profilePicture`,
// `isTopSpeaker`, `links[]`, `sessions[]`, `categoryItems[]`, `questionAnswers[]`, and that
// is the whole of it. There is no email field, deliberately, because the endpoint is
// unauthenticated. bodo's `Speaker.email` is required and is the identity the whole speaker
// side turns on: `findSpeakerByEmail` is what resolves a magic link into a session, so a
// speaker with no address owns no portal and can be sent nothing.
//
// NOTHING HERE DISPLAYS OR GENERATES AN ADDRESS. A synthesised `first.last@example.com`
// looks like data, passes every validation in this codebase, and produces a speaker whose
// magic link goes nowhere. Dropping the speaker instead would lose the programme. So they
// are created with an empty address and the run finishes owing the organizer this list.
//
// An import that looked complete and quietly produced speakers nobody can contact is the
// worst outcome available in this feature, which is why this renders as a warning that owns
// the screen rather than a line under the counts.

import Link from 'next/link'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { ScrollPanel } from '@/components/primitives/ScrollPanel'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { NeedsEmailRow } from '@/types/imports'

/**
 * Where a speaker opens, and it is the same compromise `features/search/global-search.ts`
 * already makes rather than a second answer to the same question.
 *
 * There is no speaker detail route in this build, so the honest destination is their work:
 * the Abstracts list filtered to their name, which resolves because `speakers` and
 * `submitter` are both searchable there, and which is where an organizer edits the people
 * on a session. A link into a route that does not exist would be worse than none, because
 * it makes the organizer doubt the row rather than the link.
 */
function speakerHref(eventId: string, name: string): string {
  return `/admin/${eventId}/abstracts?q=${encodeURIComponent(name)}`
}

export type NeedsEmailListProps = {
  eventId: string
  rows: readonly NeedsEmailRow[]
}

export function NeedsEmailList({ eventId, rows }: NeedsEmailListProps) {
  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <Alert>
        <AlertTitle>
          {`${String(rows.length)} speaker${rows.length === 1 ? '' : 's'} need${rows.length === 1 ? 's' : ''} an email address`}
        </AlertTitle>
        <AlertDescription>
          This source publishes no addresses, so these speakers were created without one and bodo
          did not invent any. Until each has a real address they cannot be sent a magic link, they
          own no portal, and no task or invite will reach them. The remote id is kept so you can
          find the same person on the far side.
        </AlertDescription>
      </Alert>

      <ScrollPanel className="max-h-96 rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Speaker</TableHead>
              <TableHead>Remote id</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.speakerId}>
                <TableCell className="font-medium">
                  {row.name.trim() === '' ? row.speakerId : row.name}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.remoteId}
                </TableCell>
                <TableCell className="text-right">
                  <ButtonLink href={speakerHref(eventId, row.name)} variant="outline" size="sm">
                    Find sessions
                  </ButtonLink>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollPanel>
    </div>
  )
}
