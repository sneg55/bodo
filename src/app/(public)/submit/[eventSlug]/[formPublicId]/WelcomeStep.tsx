// Step 1: the organizer's welcome content, over the auto-generated banner.
//
// The banner is two fixed sentences (see `@/features/submissions/banner`) and the body
// is whatever the organizer wrote in the builder's Welcome Screen step. Nothing on this
// step is a control, which matches ref 16: content plus navigation only.
//
// The heading above the body is the form's External Form Title. Ref 16 shows it as the H1
// over the welcome copy (`Welcome to our event!`, with the organizer's own `Call for
// Speakers` subheading below it), and the live page title was `<event name> - <that title>`.
// A form with no external title renders no heading rather than an empty one, which is the
// state every form created before the column existed is in.

import { OrganizerHtml } from '@/components/primitives/OrganizerHtml'
import type { PublicForm } from '@/features/submissions/public-form'

export function WelcomeStep({ form }: { form: PublicForm }) {
  const hasBanner = form.deadlineLine !== undefined || form.limitLine !== undefined
  const title = (form.externalTitle ?? '').trim()

  return (
    <div className="flex flex-col gap-6">
      {/* The EVENT, above everything the form says about itself.
          A public call for papers is often the first page somebody sees of a conference,
          and this one carried no event identity at all: the only heading was the form's
          title, so a speaker with three CFPs open could not tell which one they were
          writing for. Name and dates are text rather than part of the logo, because a
          logo is decoration that fails to load and an event with no logo is the common
          case. */}
      <div className="flex flex-col items-center gap-3 text-center">
        {form.eventLogoUrl === undefined ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- an organizer-supplied URL on an arbitrary host, which the image optimizer cannot be pointed at
          <img
            src={form.eventLogoUrl}
            alt={form.eventName}
            className="max-h-16 w-auto object-contain"
          />
        )}
        <div>
          <h1 className="font-heading text-xl font-semibold">{form.eventName}</h1>
          {form.eventDateLine === undefined ? null : (
            <p className="text-sm text-muted-foreground">{form.eventDateLine}</p>
          )}
        </div>
      </div>

      {hasBanner ? (
        <div className="rounded-lg border border-border px-4 py-3 text-center text-sm font-semibold">
          {form.deadlineLine === undefined ? null : <p>{form.deadlineLine}</p>}
          {form.limitLine === undefined ? null : <p>{form.limitLine}</p>}
        </div>
      ) : null}

      {/* Demoted from `h1` when the event name took that slot above. Ref 16 shows this as
          the largest heading on the step and it still is; what changed is that the page
          now has one h1 naming the event rather than two competing for it. */}
      {title.length === 0 ? null : <h2 className="text-2xl font-semibold">{title}</h2>}

      {form.welcomeHtml === undefined ? (
        <p className="text-sm text-muted-foreground">
          {`${form.eventName} is accepting submissions through this form.`}
        </p>
      ) : (
        <OrganizerHtml html={form.welcomeHtml} />
      )}
    </div>
  )
}
