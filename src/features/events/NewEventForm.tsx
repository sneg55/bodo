'use client'

// The create-event form.
//
// **It renders `EventDetailsGrid`, the settings screen's own grid, not a copy of it.** That
// is the point of the file: the eight controls, their labels, their required markers, their
// info tooltips and their order are transcribed in one place
// (docs/parity/event-config.md ref 03), and a second hand-built grid here would be a
// transcription that silently drifts from the one that was checked against the screenshot.
// `ThemeField` comes along for the same reason, counter and all.
//
// **What this screen does NOT show, and why.** The image slots and the group-type tiles are
// on the settings page and absent here: an upload needs an event id to derive its R2 key
// from, so there is nothing to upload to before Create has run. Saying so on the page is
// better than rendering two slots that would fail.
//
// **The slug follows the name until it is touched.** Typing a name fills the slug with
// `suggestSlug`, and the first edit to the slug field stops that for good. Without the
// latch, correcting the name after fixing the slug would silently overwrite the fix; with a
// latch that resets, it would be unpredictable. The suggestion is not validation: it can
// produce a slug `checkEventDetails` rejects, and the form reports that like any other.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { createEventAction } from '@/features/events/actions'
import { blankEventDraft, slugToFollow } from '@/features/events/create'
import type { EventDetailsField, SettingsProblem } from '@/features/settings/checks'
import { checkEventDetails, firstProblemFor, hasBlockingProblem } from '@/features/settings/checks'
import type { EventDetailsDraft } from '@/features/settings/draft'
import { EventDetailsGrid } from '@/features/settings/EventDetailsGrid'
import { ThemeField } from '@/features/settings/ThemeField'
import type { TimezoneOption } from '@/features/settings/timezones'

export type NewEventFormProps = {
  timezones: readonly TimezoneOption[]
  defaultTimezone: string
}

export function NewEventForm({ timezones, defaultTimezone }: NewEventFormProps) {
  const router = useRouter()
  const [draft, setDraft] = useState<EventDetailsDraft>(() => blankEventDraft(defaultTimezone))
  const [slugTouched, setSlugTouched] = useState(false)
  const [problems, setProblems] = useState<readonly SettingsProblem[]>([])
  const [pending, startTransition] = useTransition()

  function patch(next: Partial<EventDetailsDraft>): void {
    const followed = slugToFollow(next, slugTouched)
    setSlugTouched((touched) => touched || next.slug !== undefined)
    setDraft((current) => ({
      ...current,
      ...next,
      ...(followed === undefined ? {} : { slug: followed }),
    }))
  }

  function errorFor(field: EventDetailsField): string | undefined {
    return firstProblemFor(problems, field)?.message
  }

  function create(): void {
    const found = checkEventDetails(draft)
    setProblems(found)
    if (hasBlockingProblem(found)) {
      toast.error(found.map((problem) => problem.message).join(' '))
      return
    }

    startTransition(async () => {
      const result = await createEventAction({ draft })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Saved successfully')
      // Straight into the new event rather than back to the list. Creating one is
      // never the goal; setting it up is, and every next step lives inside it.
      router.push(`/admin/${result.eventId}`)
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h2 className="font-heading text-lg font-semibold">Create Event</h2>
        <p className="text-sm text-muted-foreground">Configure basic event information</p>
      </div>

      <EventDetailsGrid draft={draft} timezones={timezones} errorFor={errorFor} onPatch={patch} />

      <ThemeField
        value={draft.theme}
        error={errorFor('theme')}
        onChange={(theme) => {
          patch({ theme })
        }}
      />

      <Alert>
        <AlertDescription>
          The event starts as a draft, so its call for papers accepts nothing until you open it in
          Settings. The logo and background images are set there too, once the event has a record to
          attach them to.
        </AlertDescription>
      </Alert>

      <Separator />

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            // `/admin`, which resolves to the event they came from. There is no chooser
            // page to go back to any more: switching events is the sidebar's modal.
            router.push('/admin')
          }}
        >
          Cancel
        </Button>
        <Button disabled={pending} onClick={create}>
          {pending ? 'Creating...' : 'Create Event'}
        </Button>
      </div>
    </div>
  )
}
