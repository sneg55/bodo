'use client'

// Headshot upload (BUILD_SPEC 5.2: "Headshot upload writes to R2 and stores the URL on
// Speakers").
//
// It streams to /api/files/upload, which is the only upload design in the project: bytes
// go through the Worker into the R2 binding and nothing is buffered. The route then writes
// `headshotUrl` on the Speakers record, so this is the one file kind that is complete end
// to end today.
//
// It needs the `BODO_UPLOADS` binding and it does not pretend otherwise. With no binding
// the route answers 503 with the CFG_BINDING_MISSING message and that message is what the
// speaker sees, because an upload control that silently succeeded and stored nothing is
// worse than one that says the storage is not configured. `npm run cf:preview` is where
// the real path runs.

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { FileInput } from '@/components/primitives/FileInput'
import { Label } from '@/components/ui/label'
import { uploadFile } from '@/features/portal/upload-client'
import { useHydrated } from '@/features/portal/use-hydrated'
import { uploadHint } from '@/services/storage/upload-hint'

const HEADSHOT = uploadHint('headshot')

export function HeadshotUpload() {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  // A file picked before this hydrates has no `onChange` to reach, so the browser opens the
  // dialog, the speaker chooses their photo, and nothing whatsoever happens. Disabled until
  // the handler exists, for the reason ./use-hydrated.ts sets out.
  const ready = useHydrated()

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (file === undefined) return

    startTransition(async () => {
      const result = await uploadFile({ file, kind: 'headshot' })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Saved successfully', { description: 'Your headshot has been updated.' })
      // The route invalidated `speaker:{id}` server-side, but this browser has already
      // rendered. `refresh()` reruns the client router so the avatar above updates; it is
      // not a substitute for the invalidation and is not doing that job here.
      router.refresh()
    })
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="headshot" className="text-xs">
        Headshot
      </Label>
      {/* `accept` came from the hint rather than being spelled again here. It was an
          accurate copy of the enforced list, which is exactly the arrangement that goes
          wrong later: the two are only equal until somebody edits one of them. */}
      <FileInput
        id="headshot"
        accept={HEADSHOT.accept}
        disabled={pending || !ready}
        onChange={handleChange}
      />
      <p className="text-pretty text-xs text-muted-foreground">{HEADSHOT.text}</p>
    </div>
  )
}
