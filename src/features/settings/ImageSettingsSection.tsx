'use client'

// Image Settings (docs/parity/event-config.md ref 04).
//
// Section heading, description, both slot labels and both recommended-size helpers are
// verbatim: "Recommended: 300 w x 300 h" and "Recommended: 1500 w x 500 h". The dashed
// dropzone and the `+ Upload new` button with its dropdown chevron are the transcribed
// affordances, and both sources behind that chevron now work: a file from disk streams
// through `/api/files/upload` into R2 and lands on the event, or an image URL for an asset
// hosted somewhere else. Ref 04's chevron is ambiguity 4 in the audit ("upload from disk vs
// asset library vs URL"); there is no asset library in this build, so that one is absent
// rather than stubbed.
//
// The upload itself lives in EventImageSlot, which is also where the deviation worth knowing
// about is written down: a picked file is stored and put on the record immediately, ahead of
// the page's Save button, because the bytes are already in R2 by the time the dialog closes.

import { useState } from 'react'

import { EventImageSlot } from '@/features/settings/EventImageSlot'

export type ImageSettingsSectionProps = {
  eventId: string
  logoUrl: string
  backgroundUrl: string
  onChange: (patch: { logoUrl?: string; backgroundUrl?: string }) => void
  /**
   * Raised while either slot has bytes in flight, so the page can hold its Save.
   *
   * Two slots and one flag, tracked per kind rather than as a counter: a counter that a
   * double-fired callback decremented twice would unlock the Save while an upload was still
   * running, which is the bug this exists to prevent.
   */
  onBusyChange?: (busy: boolean) => void
}

export function ImageSettingsSection({
  eventId,
  logoUrl,
  backgroundUrl,
  onChange,
  onBusyChange,
}: ImageSettingsSectionProps) {
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  function report(kind: string, value: boolean): void {
    const next = { ...busy, [kind]: value }
    setBusy(next)
    onBusyChange?.(Object.values(next).includes(true))
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Image Settings</h2>
      <p className="text-sm text-muted-foreground">Upload event logo and background images</p>

      <EventImageSlot
        id="logo"
        eventId={eventId}
        kind="event-logo"
        label="Logo Image"
        helper="Recommended: 300 w x 300 h"
        value={logoUrl}
        aspect="size-28"
        onChange={(next) => {
          onChange({ logoUrl: next })
        }}
        onBusyChange={(value) => {
          report('logo', value)
        }}
      />
      <EventImageSlot
        id="background"
        eventId={eventId}
        kind="event-background"
        label="Background Image"
        helper="Recommended: 1500 w x 500 h"
        value={backgroundUrl}
        aspect="h-28 w-full max-w-sm"
        onChange={(next) => {
          onChange({ backgroundUrl: next })
        }}
        onBusyChange={(value) => {
          report('background', value)
        }}
      />
    </section>
  )
}
