'use client'

// The Headshot control in the roster's edit sheet. CNT-10.
//
// It used to be a bare text input called "Headshot URL", which was a real limitation and not
// a shortcut: `/api/files/upload` could only write `headshotUrl` on the speaker OF THE
// CURRENT SESSION, so an organizer had no path through it that did not become a way to write
// to any speaker row by id. The route now has an organizer branch that authorizes `admin` on
// the event and resolves the speaker against that event's own roster, so the upload is here.
//
// BOTH controls, deliberately. The picker is what an organizer reaches for with a file from
// the speaker's agency; the text field still takes a link, which is how a headshot arrives
// when it is already hosted somewhere. They edit the same value.
//
// The upload COMMITS ON ITS OWN, before Save, because the route writes `Speakers.headshotUrl`
// as its last act: the bytes are in R2 and the record already points at them. Saying so in
// the toast is better than pretending the sheet still holds the change, and the new URL is
// pushed into the form's state so pressing Save afterwards writes back the same address
// rather than the one it opened with. `router.refresh()` is what gets the row behind the
// sheet to re-read; the route already expired the tags server-side.

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { FileInput } from '@/components/primitives/FileInput'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { uploadSpeakerHeadshotFile } from '@/features/speakers/headshot-client'
import { SPEAKER_HEADSHOT_KIND } from '@/features/speakers/headshot-kind'
import { uploadHint } from '@/services/storage/upload-hint'

// From the enforced limits rather than spelled again here, so the dialog cannot offer a file
// the route will refuse and the sentence underneath cannot promise a cap it does not have.
const HEADSHOT = uploadHint(SPEAKER_HEADSHOT_KIND)

export function SpeakerHeadshotField({
  eventId,
  speakerId,
  initials,
  value,
  onChange,
  disabled,
}: {
  eventId: string
  speakerId: string
  /** For the preview before a headshot exists, matching the roster row's avatar. */
  initials: string
  value: string
  onChange: (url: string) => void
  disabled: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (file === undefined) return

    startTransition(async () => {
      const result = await uploadSpeakerHeadshotFile({ file, eventId, speakerId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      onChange(result.url)
      toast.success('Saved successfully', { description: 'The headshot has been updated.' })
      router.refresh()
    })
  }

  const busy = disabled || pending

  return (
    <div className="space-y-1.5">
      <Label htmlFor="speaker-headshot-file">Headshot</Label>
      <div className="flex items-center gap-3">
        <Avatar size="sm">
          {value === '' ? null : <AvatarImage src={value} alt="" />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <FileInput
          id="speaker-headshot-file"
          className="min-w-0 flex-1"
          accept={HEADSHOT.accept}
          disabled={busy}
          onChange={handleChange}
        />
      </div>
      <p className="text-pretty text-xs text-muted-foreground">
        {HEADSHOT.text}. Uploading saves it now.
      </p>
      <Input
        id="speaker-headshot-url"
        aria-label="Headshot URL"
        placeholder="Or paste a headshot URL"
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
