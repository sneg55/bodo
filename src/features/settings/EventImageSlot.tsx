'use client'

// One image slot on Event Settings > Image Settings (docs/parity/event-config.md ref 04).
//
// The transcribed affordances are a dashed dropzone with an upload icon and a `+ Upload new`
// button with a dropdown chevron, so both are here and the dropzone accepts a real drop
// rather than only looking like it would.
//
// The dropdown offers both sources the audit's ambiguity 4 left open ("upload from disk vs
// asset library vs URL"): a file from disk, which streams through `/api/files/upload` into R2
// and lands on the event as soon as the bytes are verified, and an image URL, for an asset
// already hosted somewhere public. There is no asset library in this build, so that third
// possibility is simply absent rather than stubbed.
//
// Split out of ImageSettingsSection so neither file carries two jobs: the section owns the
// heading and the two slots' copy, and this owns the upload.

import { ImageIcon, PlusIcon, TrashIcon, UploadIcon } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { FileInput } from '@/components/primitives/FileInput'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { uploadEventImageFile } from '@/features/settings/event-image-client'
import { EVENT_IMAGE_ACCEPT, type EventImageKind } from '@/features/settings/event-images'
import { cn } from '@/utils/cn'

export type EventImageSlotProps = {
  id: string
  eventId: string
  kind: EventImageKind
  label: string
  helper: string
  value: string
  /** Sizing classes for the dropzone, so the two slots keep their real proportions. */
  aspect: string
  onChange: (value: string) => void
  /**
   * Reports whether bytes are in flight, so the PAGE's Save can be held while they are.
   *
   * Not cosmetic. Found by Codex review: this slot writes its image column itself, while the
   * page's Save writes the whole record including both image columns out of its own draft. Drop
   * a file and press Save before it lands and the two writes race; the Save carries the OLD url,
   * and whichever reaches Airtable last wins. The image reverts while the upload still reports
   * success, and the object it stored is orphaned. Disabling one button is the whole fix, and it
   * has to be the page's button because the page is the other writer.
   */
  onBusyChange?: (busy: boolean) => void
}

export function EventImageSlot({
  id,
  eventId,
  kind,
  label,
  helper,
  value,
  aspect,
  onChange,
  onBusyChange,
}: EventImageSlotProps) {
  const [urlOpen, setUrlOpen] = useState(false)
  const [fileOpen, setFileOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [dragging, setDragging] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function upload(file: File | undefined): void {
    // A second file while the first is still streaming would race the two writes to the same
    // column, and the loser would win at random.
    if (file === undefined || pending) return

    onBusyChange?.(true)
    startTransition(async () => {
      // `finally` and not two call sites: an upload that throws must still release the page's
      // Save, or a failed drop would leave the whole settings page unsaveable until reload.
      try {
        await store(file)
      } finally {
        onBusyChange?.(false)
      }
    })
  }

  async function store(file: File): Promise<void> {
    const result = await uploadEventImageFile({ file, kind, eventId })
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    // The route already wrote the column and expired the tags it affects, so this is the
    // form catching up with a save that has happened, not a pending edit.
    onChange(result.url)
    setFileOpen(false)
    toast.success('Saved successfully', { description: `${label} has been updated.` })
    // The server cache is expired; this browser has already rendered. `refresh()` reruns
    // the client router so anything else on screen showing the image catches up. It is not
    // doing the invalidation's job and is not a substitute for it.
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-url`}>{label}</Label>
      <p className="text-xs text-muted-foreground">{helper}</p>

      <div className="flex items-start gap-3">
        {/* A drop target, not a control: the `+ Upload new` button beside it is the
            keyboard-reachable way to do everything this accepts. */}
        <div
          className={cn(
            'relative flex items-center justify-center overflow-hidden rounded-xl border border-dashed bg-muted/20',
            aspect,
            dragging ? 'border-primary bg-primary/5' : 'border-input',
            pending && 'opacity-60',
          )}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => {
            setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            upload(event.dataTransfer.files.item(0) ?? undefined)
          }}
        >
          {value === '' ? (
            <ImageIcon className="size-6 text-muted-foreground" />
          ) : (
            // `unoptimized`, because the src is either an R2 public URL or whatever an
            // organizer pasted: routing it through the Next image optimizer would need every
            // host they might use listed in `images.remotePatterns`, and an unlisted one
            // renders as a broken preview rather than as the image they just picked.
            <Image src={value} alt="" fill unoptimized sizes="200px" className="object-contain" />
          )}
        </div>

        <div className="flex flex-col items-start gap-1.5">
          <DropdownMenu>
            {/* 34px, the column's own pitch: two 28px buttons 6px apart, so a 40px box would
                cross the one below by 6px. */}
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="hit-area-[34px]"
                  disabled={pending}
                />
              }
            >
              {/* `data-icon="inline-start"` is what trips the Button cva's optical padding:
                  a leading glyph needs less space before it than a letter does, and the
                  compensation only fires when the attribute is present. */}
              <PlusIcon data-icon="inline-start" />
              {pending ? 'Uploading...' : 'Upload new'}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Add an image</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    setFileOpen(true)
                  }}
                >
                  <UploadIcon />
                  Upload a file
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setDraft(value)
                    setUrlOpen(true)
                  }}
                >
                  Use an image URL
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {value === '' ? null : (
            <Button
              variant="ghost"
              size="sm"
              className="hit-area-[34px]"
              disabled={pending}
              onClick={() => {
                onChange('')
              }}
            >
              <TrashIcon data-icon="inline-start" />
              Remove
            </Button>
          )}
        </div>
      </div>

      <Dialog open={fileOpen} onOpenChange={setFileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              Choose a PNG, JPEG or WebP image. It uploads straight away and replaces the current
              one. Dragging a file onto the dashed box does the same thing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-file`}>{helper}</Label>
            <FileInput
              id={`${id}-file`}
              accept={EVENT_IMAGE_ACCEPT}
              disabled={pending}
              onChange={(event) => {
                upload(event.currentTarget.files?.[0])
              }}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              Paste the address of an image that is already hosted somewhere public.
            </DialogDescription>
          </DialogHeader>
          <Input
            id={`${id}-url`}
            value={draft}
            placeholder="https://example.com/logo.png"
            onChange={(event) => {
              setDraft(event.target.value)
            }}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={() => {
                onChange(draft.trim())
                setUrlOpen(false)
              }}
            >
              Use this image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
