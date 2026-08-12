'use client'

import { PlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

import { createSessionAction } from '../actions'
import type { AgendaParticipant } from '../types'

/**
 * The format vocabulary, as `value -> label`, in ONE place.
 *
 * It feeds both the options and the trigger, because those are the two halves that were
 * out of step: the list read "Talk" while the closed trigger read `talk`. Base UI's
 * `Select.Value` prints the raw value unless `Select.Root` is handed an `items` map, so
 * writing the labels only as `<SelectItem>` children leaves the trigger showing whatever
 * is stored.
 */
const FORMATS: Record<string, string> = {
  talk: 'Talk',
  workshop: 'Workshop',
  panel: 'Panel',
  keynote: 'Keynote',
}

export function AddSessionSheet({
  eventId,
  speakers,
}: {
  eventId: string
  speakers: readonly AgendaParticipant[]
}) {
  const [open, setOpen] = useState(false)
  const [speakerId, setSpeakerId] = useState<string | null>(speakers.at(0)?.id ?? null)
  const [format, setFormat] = useState<string | null>('talk')
  const [isPending, startTransition] = useTransition()

  const submit = (formData: FormData) => {
    startTransition(async () => {
      try {
        await createSessionAction(eventId, formData)
        toast.success('Session added')
        setOpen(false)
      } catch {
        toast.error('The session could not be added.')
      }
    })
  }

  return (
    <>
      <Button className="order-1" onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        Add Session
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md!">
          <SheetHeader>
            <SheetTitle>Add Session</SheetTitle>
            <SheetDescription>
              Add a confirmed session. It will start in the unscheduled tray.
            </SheetDescription>
          </SheetHeader>
          <form action={submit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agenda-session-title">Title</Label>
              <Input
                id="agenda-session-title"
                name="title"
                required
                maxLength={255}
                placeholder="Session title"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agenda-session-speaker">Primary speaker</Label>
              <Input type="hidden" name="speakerId" value={speakerId ?? ''} readOnly />
              <Select
                // Without this the closed trigger read `rec4zyLcalea4kNxh`, because Base UI's
                // `Select.Value` prints the raw value and the value here is the record id the
                // create action needs. The names were only ever in the option children, which
                // the trigger does not see. Same fix as the Track filter in `AbstractsTable`.
                items={Object.fromEntries(speakers.map((speaker) => [speaker.id, speaker.name]))}
                value={speakerId}
                onValueChange={setSpeakerId}
                disabled={speakers.length === 0}
              >
                <SelectTrigger id="agenda-session-speaker" className="w-full">
                  <SelectValue placeholder="Select a speaker" />
                </SelectTrigger>
                <SelectContent>
                  {speakers.map((speaker) => (
                    <SelectItem key={speaker.id} value={speaker.id}>
                      {speaker.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {speakers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add an event speaker before creating a session.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agenda-session-format">Format</Label>
              <Input type="hidden" name="format" value={format ?? ''} readOnly />
              <Select items={FORMATS} value={format} onValueChange={setFormat}>
                <SelectTrigger id="agenda-session-format" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FORMATS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <SheetFooter className="mt-auto flex-row justify-end px-0">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || speakerId === null}>
                Create Session
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  )
}
