'use client'

// Event Settings > Event Details (docs/parity/event-config.md refs 03 and 04).
//
// **Exhibitors & Sponsors is gone from this page.** It used to render ref 04's section
// heading, its two tiles and their green check badges, all disabled, with a note saying
// group management is out of scope. That followed BUILD_SPEC 5.0b, whose argument was that
// an admin who knows the product notices a missing section before they notice a disabled
// one. Removed on the owner's instruction, and the argument does not survive contact with
// the result: the section was three paragraphs of apology and two controls that could never
// do anything, on the one settings page an organizer visits to change something. A surface
// that only explains why it is inert is not familiarity, it is an obstacle wearing
// familiarity's clothes. BUILD_SPEC 5.0b and the parity checklist are amended to match
// rather than left describing a section that no longer exists.
//
// One Save at the bottom covering the whole page, which is the save model the audit
// records ("no evidence of autosave"). Client state rather than a native form POST because
// the page has a live character counter, a date-time picker whose display depends on the
// timezone selected two fields above it, and a slug warning that appears while typing:
// none of that survives without JavaScript, and mutations here are Server Actions anyway
// (.claude/rules/bodo-conventions.md).
//
// Validation runs locally on submit so the four required fields report together, and the
// action re-runs it: the client copy is a convenience, the action is the protection.
//
// The slug warning is the one piece of copy on this page that is not transcribed, and it is
// deliberate: `docs/parity/event-config.md` lists "whether changing Event Slug is allowed
// after forms/portals are live" as an open ambiguity, and the answer here is that it is
// allowed and it breaks every link already shared, because the slug is in the public URL of
// both the CFP form and the public agenda. Saying so is better than either silently
// breaking the links or refusing the edit.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { saveEventDetailsAction } from '@/features/settings/actions'
import type { EventDetailsField, SettingsProblem } from '@/features/settings/checks'
import { checkEventDetails, firstProblemFor, hasBlockingProblem } from '@/features/settings/checks'
import type { EventDetailsDraft } from '@/features/settings/draft'
import { EventDetailsGrid } from '@/features/settings/EventDetailsGrid'
import { ImageSettingsSection } from '@/features/settings/ImageSettingsSection'
import { ThemeField } from '@/features/settings/ThemeField'
import type { TimezoneOption } from '@/features/settings/timezones'

export type EventDetailsFormProps = {
  eventId: string
  initial: EventDetailsDraft
  timezones: readonly TimezoneOption[]
}

export function EventDetailsForm({ eventId, initial, timezones }: EventDetailsFormProps) {
  const [draft, setDraft] = useState(initial)
  const [savedSlug, setSavedSlug] = useState(initial.slug)
  const [problems, setProblems] = useState<readonly SettingsProblem[]>([])
  const [pending, startTransition] = useTransition()
  /**
   * Held while an image slot has bytes in flight. Save writes the WHOLE record, both image
   * columns included, out of `draft`; the upload writes its own column directly. Saving mid-flight
   * raced the two and the loser won at random, reverting a just-uploaded image while the upload
   * still reported success. Found by Codex review.
   */
  const [uploading, setUploading] = useState(false)

  function patch(next: Partial<EventDetailsDraft>): void {
    setDraft((current) => ({ ...current, ...next }))
  }

  function errorFor(field: EventDetailsField): string | undefined {
    return firstProblemFor(problems, field)?.message
  }

  function save(): void {
    const found = checkEventDetails(draft)
    setProblems(found)
    if (hasBlockingProblem(found)) {
      toast.error(found.map((problem) => problem.message).join(' '))
      return
    }

    startTransition(async () => {
      const result = await saveEventDetailsAction({ eventId, draft })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // Adopt the stored slug, which is trimmed and lowercased, so the field stops showing
      // a value the record does not have.
      setDraft((current) => ({ ...current, slug: result.slug }))
      setSavedSlug(result.slug)
      toast.success('Saved successfully')
    })
  }

  const slugChanged = draft.slug.trim().toLowerCase() !== savedSlug.trim().toLowerCase()

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h2 className="font-heading text-lg font-semibold">Event Details</h2>
        <p className="text-sm text-muted-foreground">Configure basic event information</p>
      </div>

      <EventDetailsGrid draft={draft} timezones={timezones} errorFor={errorFor} onPatch={patch} />

      {slugChanged ? (
        // This appears mid-keystroke, the moment the slug stops matching the saved one, and
        // it inserts a three-line block between the grid and the Theme section. Popping in at
        // full opacity reads as a layout glitch; a short fade and a 4px drop reads as an
        // answer to what was just typed. Enter only: React unmounts it the moment the slug
        // matches again, so there is no exit frame to animate without a presence wrapper.
        <Alert className="animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-[cubic-bezier(0.2,0,0,1)]">
          <AlertDescription>
            Changing the slug changes the public links for this event. Anyone holding the old{' '}
            <span className="font-mono">/submit/{savedSlug}/...</span> or{' '}
            <span className="font-mono">/agenda/{savedSlug}</span> link will stop reaching it.
          </AlertDescription>
        </Alert>
      ) : null}

      <ThemeField
        value={draft.theme}
        error={errorFor('theme')}
        onChange={(theme) => {
          patch({ theme })
        }}
      />

      <Separator />
      <ImageSettingsSection
        eventId={eventId}
        logoUrl={draft.logoUrl}
        backgroundUrl={draft.backgroundUrl}
        onChange={patch}
        onBusyChange={setUploading}
      />

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending || uploading}>
          {pending ? 'Saving...' : 'Save'}
        </Button>
        {uploading ? (
          <span className="text-xs text-muted-foreground">
            Waiting for the image upload to finish.
          </span>
        ) : null}
      </div>
    </div>
  )
}
