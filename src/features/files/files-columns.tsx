'use client'

// The Files list's columns, and the catalog its Columns picker offers.
//
// Split out of FilesTable.tsx so that file holds the table's state and this one holds its
// cells. The catalog is the substantive part: `DataTable` defaults to the 22-field SESSION
// registry, so the drawer over a table of FILES offered Track, Room and Abstract, and the
// surface committed nothing back, which made it a control that could not do anything whatever
// an organizer picked. Every field named here has a cell and an accessor.

import { FileIcon } from 'lucide-react'
import type { DataTableCatalog, DataTableColumn } from '@/components/primitives/data-table-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { RegistryField } from '@/constants/fields'
import { CopyFileLinkButton } from '@/features/files/CopyFileLinkButton'
import { FileCommentsPopover } from '@/features/files/FileCommentsPopover'
import { FILE_QUERYABLE_KEYS } from '@/features/files/files-query'
import type { FileListRow } from '@/features/files/reads'
import { cn } from '@/utils/cn'

const FILE_FIELDS: readonly RegistryField[] = [
  {
    key: 'filename',
    label: 'File',
    type: 'text',
    group: 'session',
    column: false,
    defaultVisible: true,
    help: 'The stored filename, as the speaker uploaded it.',
  },
  {
    key: 'file-open',
    label: 'Link',
    type: 'text',
    group: 'session',
    column: false,
    defaultVisible: true,
    help: 'Public objects link straight to the bucket. A private one is streamed through an authenticated route, so only somebody with a role on this event can read it, and the copy control hands that same link to a colleague.',
  },
  {
    key: 'file-type',
    label: 'Type',
    type: 'select',
    group: 'session',
    column: false,
    defaultVisible: true,
    help: 'Headshot, slides, or a document delivered against a file request.',
  },
  {
    key: 'file-owner',
    label: 'Speaker',
    type: 'text',
    group: 'participant',
    column: false,
    defaultVisible: true,
    help: 'Who uploaded it. Files are stored against a speaker, always.',
  },
  {
    key: 'file-session',
    label: 'Session',
    type: 'text',
    group: 'session',
    column: false,
    defaultVisible: true,
    help: 'The submission the file is attached to, when it is attached to one.',
  },
  {
    key: 'file-size',
    label: 'Size',
    type: 'text',
    group: 'reporting',
    column: false,
    defaultVisible: true,
    help: 'Rounded to whole megabytes, or kilobytes below one.',
  },
  {
    key: 'file-uploaded',
    label: 'Uploaded',
    type: 'datetime',
    group: 'scheduling',
    column: false,
    defaultVisible: true,
    help: "The upload date and time, in the event's timezone. The time is shown because two versions of the same file routinely arrive on the same day, and a date alone cannot order them.",
  },
  {
    key: 'file-comments',
    label: 'Comments',
    type: 'text',
    group: 'session',
    column: false,
    defaultVisible: true,
    help: 'Notes on this deliverable, kept with who wrote them and when. Append only, and shared by every version of the file, so a request survives the upload that answers it.',
  },
]

export const FILES_CATALOG: DataTableCatalog = {
  fields: FILE_FIELDS,
  // Exactly the keys files-query.ts can answer. Link and Comments are a pair of buttons and a
  // thread, so ordering by either is not something anybody means, and offering them would put
  // back the dead control this catalog exists to remove.
  queryableFields: FILE_FIELDS.filter((field) => FILE_QUERYABLE_KEYS.has(field.key)),
  defaultColumnKeys: FILE_FIELDS.map((field) => field.key),
}

export const FILES_COLUMN_KEYS: readonly string[] = FILES_CATALOG.defaultColumnKeys

export function fileColumns(eventId: string): readonly DataTableColumn<FileListRow>[] {
  return [
    {
      key: 'filename',
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2">
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
          {/* A superseded row is dimmed rather than hidden. Hiding it would lose the history
              that re-uploading has always kept, and an organizer chasing a speaker who "sent
              it twice" needs to see both. */}
          <span
            className={cn(
              'truncate font-medium',
              row.isLatest ? undefined : 'text-muted-foreground',
            )}
          >
            {row.filename}
          </span>
          {row.groupSize === 1 ? null : (
            <Badge variant={row.isLatest ? 'default' : 'outline'} className="shrink-0">
              {row.isLatest ? `Latest of ${String(row.groupSize)}` : `v${String(row.version)}`}
            </Badge>
          )}
        </div>
      ),
    },
    // SECOND, directly against the filename it acts on, not last.
    //
    // It sat at the far right, six columns and most of the page away from the name of the
    // thing it downloads. Reading a row therefore meant crossing Type, Speaker, Session, Size
    // and Uploaded to reach the one control on it, and on a narrow window the button was off
    // the end of a horizontal scroll. An action belongs beside its subject.
    {
      key: 'file-open',
      cell: (row) => {
        if (row.href !== undefined) {
          const isPrivate = row.visibility === 'private'
          return (
            <span className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="hit-area-y"
                nativeButton={false}
                render={
                  // A private object comes back as an attachment, so it saves rather than
                  // replacing the tab the organizer clicked from, and it needs no `_blank`. A
                  // public one is a bucket URL and opens in a new tab as it always did.
                  isPrivate ? (
                    <a href={row.href} download={row.filename} />
                  ) : (
                    <a href={row.href} rel="noreferrer noopener" target="_blank" />
                  )
                }
              >
                {isPrivate ? 'Download' : 'Open'}
              </Button>
              <CopyFileLinkButton href={row.href} filename={row.filename} isPrivate={isPrivate} />
            </span>
          )
        }
        // The only absence left, and it is a DEPLOYMENT fact rather than a property of the
        // file: a public object with no link means `R2_PUBLIC_BASE_URL` is unset. Private
        // objects used to land here too and rendered a bare "Private" badge, which described
        // the file accurately and left the organizer with nothing to click; they now go
        // through the authenticated route above.
        return <span className="text-muted-foreground">No public URL configured</span>
      },
    },
    {
      key: 'file-type',
      cell: (row) => (
        <span className="flex items-center gap-1.5">
          {row.typeLabel}
          {row.requested ? <Badge variant="secondary">Requested</Badge> : null}
        </span>
      ),
    },
    { key: 'file-owner', cell: (row) => row.speakerLabel },
    { key: 'file-session', cell: (row) => row.sessionLabel ?? '-' },
    { key: 'file-size', cell: (row) => row.sizeLabel },
    {
      key: 'file-uploaded',
      cell: (row) => <span className="whitespace-nowrap tabular-nums">{row.uploadedText}</span>,
    },
    {
      key: 'file-comments',
      cell: (row) => (
        <FileCommentsPopover
          eventId={eventId}
          fileId={row.id}
          filename={row.filename}
          groupSize={row.groupSize}
          comments={row.comments}
        />
      ),
    },
  ]
}
