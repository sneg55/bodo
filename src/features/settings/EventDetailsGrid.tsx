'use client'

// The two-column form grid of Event Details (docs/parity/event-config.md ref 03).
//
// Labels, required markers and field order are transcribed: Event Name, Event Slug, Event
// Type, Event Website URL, Event Location, Timezone, Starts At, Ends At. Info icons sit on
// every field the screenshot shows one on.
//
// The Event Type `Select` passes `items`, and that is not optional: base-ui's
// `Select.Value` renders the raw value when it cannot look a label up, which has shipped
// as a bug twice in this codebase.
//
// Split out of EventDetailsForm to keep both files under the 300 line limit; the form owns
// the state and the save, this file owns the controls.

import { DateTimeField } from '@/components/primitives/DateTimeField'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { EventDetailsField } from '@/features/settings/checks'
import { EVENT_TYPE_OPTIONS, type EventDetailsDraft } from '@/features/settings/draft'
import { FieldRow } from '@/features/settings/FieldRow'
import { TimezonePicker } from '@/features/settings/TimezonePicker'
import type { TimezoneOption } from '@/features/settings/timezones'
import { FIELD_HINTS } from '@/features/settings/tooltips'

const EVENT_TYPE_ITEMS = EVENT_TYPE_OPTIONS.map((value) => ({ value, label: value }))

export type EventDetailsGridProps = {
  draft: EventDetailsDraft
  timezones: readonly TimezoneOption[]
  errorFor: (field: EventDetailsField) => string | undefined
  onPatch: (patch: Partial<EventDetailsDraft>) => void
}

export function EventDetailsGrid({ draft, timezones, errorFor, onPatch }: EventDetailsGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FieldRow htmlFor="event-name" label="Event Name" required error={errorFor('name')}>
        <Input
          id="event-name"
          value={draft.name}
          onChange={(event) => {
            onPatch({ name: event.target.value })
          }}
        />
      </FieldRow>

      <FieldRow
        htmlFor="event-slug"
        label="Event Slug"
        required
        hint={FIELD_HINTS.slug}
        error={errorFor('slug')}
      >
        <Input
          id="event-slug"
          value={draft.slug}
          spellCheck={false}
          onChange={(event) => {
            onPatch({ slug: event.target.value })
          }}
        />
      </FieldRow>

      <FieldRow
        htmlFor="event-type"
        label="Event Type"
        hint={FIELD_HINTS.eventType}
        error={errorFor('eventType')}
      >
        <Select
          value={draft.eventType}
          items={EVENT_TYPE_ITEMS}
          onValueChange={(next: string | null) => {
            if (next !== null) onPatch({ eventType: next })
          }}
        >
          <SelectTrigger id="event-type" className="w-full">
            <SelectValue placeholder="Select a type" />
          </SelectTrigger>
          <SelectContent>
            {EVENT_TYPE_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      <FieldRow
        htmlFor="event-website"
        label="Event Website URL"
        hint={FIELD_HINTS.websiteUrl}
        error={errorFor('websiteUrl')}
      >
        <Input
          id="event-website"
          value={draft.websiteUrl}
          spellCheck={false}
          onChange={(event) => {
            onPatch({ websiteUrl: event.target.value })
          }}
        />
      </FieldRow>

      <FieldRow
        htmlFor="event-location"
        label="Event Location"
        hint={FIELD_HINTS.location}
        error={errorFor('location')}
      >
        <Input
          id="event-location"
          value={draft.location}
          onChange={(event) => {
            onPatch({ location: event.target.value })
          }}
        />
      </FieldRow>

      <FieldRow
        htmlFor="event-timezone"
        label="Timezone"
        hint={FIELD_HINTS.timezone}
        error={errorFor('timezone')}
      >
        <TimezonePicker
          id="event-timezone"
          value={draft.timezone}
          options={timezones}
          onChange={(timezone) => {
            onPatch({ timezone })
          }}
        />
      </FieldRow>

      <FieldRow
        htmlFor="event-starts-at"
        label="Starts At"
        required
        hint={FIELD_HINTS.startsAt}
        error={errorFor('startsAt')}
      >
        <DateTimeField
          id="event-starts-at"
          value={draft.startsAt}
          timeZone={draft.timezone}
          onChange={(startsAt) => {
            onPatch({ startsAt })
          }}
        />
      </FieldRow>

      <FieldRow
        htmlFor="event-ends-at"
        label="Ends At"
        required
        hint={FIELD_HINTS.endsAt}
        error={errorFor('endsAt')}
      >
        <DateTimeField
          id="event-ends-at"
          value={draft.endsAt}
          timeZone={draft.timezone}
          onChange={(endsAt) => {
            onPatch({ endsAt })
          }}
        />
      </FieldRow>
    </div>
  )
}
