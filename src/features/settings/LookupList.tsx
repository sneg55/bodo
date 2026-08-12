'use client'

// One kind's rows on Library > Tags: rename in place, remove with confirmation, add at the
// bottom.
//
// Split from LibraryPanel so both stay under the 300 line limit. This file owns one list;
// the panel owns the tab strip and the three lists' state.
//
// Removal goes through `AlertDialog` and not `confirm()`, which is banned, and the copy says
// what it costs: Airtable clears the link on every submission that pointed at the row, so a
// removed track leaves accepted sessions with no category.

import { PlusIcon, TrashIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  addLookupAction,
  removeLookupAction,
  renameLookupAction,
} from '@/features/settings/lookup-actions'
import { type LookupEntry, type LookupKind, lookupLabel } from '@/features/settings/lookups'

export type LookupListProps = {
  eventId: string
  kind: LookupKind
  entries: readonly LookupEntry[]
}

export function LookupList({ eventId, kind, entries: initial }: LookupListProps) {
  const [entries, setEntries] = useState<readonly LookupEntry[]>(initial)
  const [added, setAdded] = useState('')
  const [pending, startTransition] = useTransition()
  const label = lookupLabel(kind)

  function add(): void {
    startTransition(async () => {
      const result = await addLookupAction({ eventId, kind, name: added })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setEntries((current) => [...current, { id: result.id, name: result.name }])
      setAdded('')
      toast.success('Saved successfully')
    })
  }

  function rename(id: string, name: string): void {
    startTransition(async () => {
      const result = await renameLookupAction({ eventId, kind, id, name })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, name: result.name } : entry)),
      )
      toast.success('Saved successfully')
    })
  }

  function remove(id: string): void {
    startTransition(async () => {
      const result = await removeLookupAction({ eventId, kind, id })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setEntries((current) => current.filter((entry) => entry.id !== id))
      toast.success('Saved successfully')
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No {label.plural.toLowerCase()} yet. Add one below.
        </p>
      ) : null}

      {entries.map((entry) => (
        <Row
          key={entry.id}
          entry={entry}
          kind={kind}
          disabled={pending}
          onRename={(name) => {
            rename(entry.id, name)
          }}
          onRemove={() => {
            remove(entry.id)
          }}
        />
      ))}

      <div className="flex items-end gap-2 pt-1">
        <div className="flex-1">
          <Label htmlFor={`add-${kind}`} className="mb-1.5">
            Add a {label.singular.toLowerCase()}
          </Label>
          <Input
            id={`add-${kind}`}
            value={added}
            placeholder={label.singular}
            onChange={(event) => {
              setAdded(event.target.value)
            }}
          />
        </div>
        <Button variant="outline" disabled={pending || added.trim() === ''} onClick={add}>
          <PlusIcon data-icon="inline-start" />
          Add
        </Button>
      </div>
    </div>
  )
}

type RowProps = {
  entry: LookupEntry
  kind: LookupKind
  disabled: boolean
  onRename: (name: string) => void
  onRemove: () => void
}

function Row({ entry, kind, disabled, onRename, onRemove }: RowProps) {
  const [name, setName] = useState(entry.name)
  // Controlled, so confirming closes the dialog: `AlertDialogAction` is a plain Button and
  // does not dismiss on its own.
  const [confirming, setConfirming] = useState(false)
  const label = lookupLabel(kind)
  const dirty = name.trim() !== entry.name.trim()

  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={`${label.singular} name`}
        value={name}
        disabled={disabled}
        onChange={(event) => {
          setName(event.target.value)
        }}
      />
      <Button
        variant="outline"
        size="sm"
        className="hit-area-y"
        disabled={disabled || !dirty}
        onClick={() => {
          onRename(name)
        }}
      >
        Save
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="hit-area"
              aria-label="Remove"
              disabled={disabled}
            >
              <TrashIcon />
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {label.singular.toLowerCase()} &quot;{entry.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every submission linked to it loses that link. Nothing else is deleted, and this
              cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="outline" />}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              render={
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirming(false)
                    onRemove()
                  }}
                />
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
