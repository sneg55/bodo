// `/admin/new`: create an event.
//
// **Why it sits beside `[eventId]` rather than under it.** Everything under
// `admin/[eventId]` is wrapped by a layout that resolves the event, authorizes a role on
// it, and renders the sidebar and top bar for it. None of that can run for an event that
// does not exist. A static segment also beats a dynamic sibling in Next's route matching,
// and no Airtable record id is ever the literal string `new` (they all begin `rec`), so
// there is nothing for the two to fight over.
//
// **There is no admin chrome on this page and that is deliberate.** The sidebar is an event
// switcher plus that event's nav tree; drawing it here would mean drawing the navigation of
// some OTHER event around a form for a new one. The page is framed like `/admin` and
// `/login`, which are the other two routes that exist outside an event.
//
// The session check is a redirect from the page BODY, per the rule this tree keeps hitting:
// a `redirect()` from inside a Suspense boundary resolves after the shell has flushed and
// never produces a response on Workers, which is why there is no `loading.tsx` here either.

import { redirect } from 'next/navigation'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isAppError } from '@/constants/errorIds'
import { requireAdminUser } from '@/features/auth/guards'
import { DEFAULT_NEW_EVENT_TIMEZONE } from '@/features/events/create'
import { NewEventForm } from '@/features/events/NewEventForm'
import { timezoneOptions } from '@/features/settings/timezones'

export const metadata = { title: 'Create Event' }

export default async function NewEventPage() {
  if (!(await hasAdminSession())) {
    redirect(`/login?audience=admin&next=${encodeURIComponent('/admin/new')}`)
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>New Event</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Built on the server for the reason the settings page gives: several hundred
              zones, one `Intl.DateTimeFormat` each, and offsets that must come from the
              same runtime the agenda renders with. */}
          <NewEventForm
            timezones={timezoneOptions()}
            defaultTimezone={DEFAULT_NEW_EVENT_TIMEZONE}
          />
        </CardContent>
      </Card>
    </main>
  )
}

/**
 * Whether there is a usable organizer session.
 *
 * A boolean rather than letting the guard throw, so the `redirect()` above happens in the
 * page body: `redirect` unwinds by throwing, so calling it inside the try would be caught
 * here and reported as a missing session. Same shape as `admin/page.tsx`.
 *
 * Not the security boundary. `createEventAction` calls `requireAdminUser` for itself,
 * because an action is reachable by POST without this page ever rendering (BUILD_SPEC 4).
 */
async function hasAdminSession(): Promise<boolean> {
  try {
    await requireAdminUser({ nowMs: Date.now() })
    return true
  } catch (error) {
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return false
    throw error
  }
}
