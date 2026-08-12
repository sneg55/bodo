// Event Settings > Integrations > Import from one provider. BUILD_SPEC 5.0e, "Surface".
//
// Entered from a provider row, always, which is why the source is a path segment rather
// than the wizard's first step: the row that was clicked already named it. 5.0e lists
// `source` as step one and then says it is "skipped when entered from a provider row", and
// this route is what makes that true rather than something the wizard has to remember.
//
// ONE FILE, not a static shell plus an `ImportWizardBody` inside `<Suspense>`. That split
// needs a slow read behind something the visitor can already be shown, and there is no slow
// read here: the page resolves a route param, asks who is looking, and reads the event
// record for the one prefill the Accelevents arm needs. Everything expensive in this
// feature is behind a button.
//
// `notFound()` is called in the page BODY and not from inside a boundary, per the project
// rule. The documented and accepted cost applies: the settings tree has route-level
// `loading.tsx` files, so the shell has already flushed and this answers HTTP 200 with the
// 404 body (.claude/rules/bodo-conventions.md). Nothing is disclosed by it, and the
// alternative is losing the admin chrome painting while the page resolves.

import { notFound } from 'next/navigation'
import { ImportWizard } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/import/[source]/ImportWizard'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { requireEventId } from '@/features/events/resolve-ref'
import { importWizardRole } from '@/features/imports/authorize'
import { getEvent } from '@/services/airtable/queries'
import { integrationProvider } from '@/services/integrations/registry'
import { IMPORT_SOURCES, type ImportSource } from '@/types/imports'

export const metadata = { title: 'Import' }

function isSource(value: string): value is ImportSource {
  return (IMPORT_SOURCES as readonly string[]).includes(value)
}

/**
 * The Accelevents prefill, in the shape `parseAcceleventsRef` reads back out.
 *
 * `<eventId>:<eventUrl>`, or the bare url when §5.7 recorded no id. The bare form is
 * accepted on purpose and degrades rather than failing: without the id the admin reads
 * cannot be addressed and the run falls back to the attendee-visible session list, which
 * carries no speakers. The preview says so as a warning rather than taking it silently.
 */
function acceleventsRef(event: { accelEventId?: string; accelEventUrl?: string }): string {
  const url = event.accelEventUrl ?? ''
  if (url === '') return ''
  return event.accelEventId === undefined ? url : `${event.accelEventId}:${url}`
}

export default async function ImportWizardPage({
  params,
}: {
  params: Promise<{ eventId: string; source: string }>
}) {
  const { eventId: eventRef, source } = await params
  const eventId = await requireEventId(eventRef)
  if (!isSource(source)) notFound()

  const role = await importWizardRole(eventId)
  if (role === undefined) return null

  const provider = integrationProvider(source)
  const backHref = `/admin/${eventId}/settings/integrations`

  // A reviewer may read the Integrations page, so they can reach this link. They get the
  // reason rather than a blank screen or a redirect: an import writes the whole event, and
  // there is no read-only half of this wizard worth rendering. The actions refuse them
  // anyway, which is where the rule is actually enforced.
  if (role !== 'admin') {
    return (
      <Alert>
        <AlertTitle>Importing needs the admin role on this event</AlertTitle>
        <AlertDescription>
          An import writes rooms, tracks, tags, speakers, sessions and the agenda for the whole
          event, so it is not something a reviewer can start. Past runs are listed under each
          provider on the Integrations page.
        </AlertDescription>
      </Alert>
    )
  }

  const event = await getEvent(eventId)

  return (
    <ImportWizard
      eventId={eventId}
      source={source}
      providerLabel={provider.label}
      acceleventsRef={acceleventsRef(event)}
      backHref={backHref}
    />
  )
}
