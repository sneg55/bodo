// /admin/crm/import
//
// A sibling of `[speakerId]`, NOT a child of the `(directory)` group, and the placement is the
// point: `(directory)` exists to keep its `loading.tsx` off routes that can 404, because a
// `notFound()` reached from inside a Suspense boundary answers HTTP 200 with the 404 body.
// This route has no id to miss with - the layout above has already 404'd a viewer with no
// membership, in its own body, before the first byte - so nothing here can 404 and the
// `loading.tsx` beside this file is safe. Its own comment records the check.
//
// The scope is re-derived rather than taken from the layout, as every other CRM surface does:
// a layout does not revalidate on every navigation and is not a security boundary. The events
// it names are the ONLY events the wizard offers, and `commitSpeakerImportAction` checks the
// chosen one against this same set again for itself, because the wizard is one client and
// anything that can POST is another.

import { UploadIcon } from 'lucide-react'

import { PageHeader } from '@/components/primitives/PageHeader'
import { ImportWizard } from '@/features/crm/import/ImportWizard'
import { requireCrmScope } from '@/features/crm/scope'
import { getEvent } from '@/services/airtable/queries'

export default async function CrmImportPage() {
  const scope = await requireCrmScope()
  const events = await Promise.all(
    scope.eventIds.map(async (eventId) => {
      const event = await getEvent(eventId)
      return { id: event.id, name: event.name }
    }),
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={UploadIcon}
        title="Import speakers"
        description="Add or update speakers from a CSV. Rows are matched to existing speakers by email."
      />
      <ImportWizard events={events} />
    </div>
  )
}
