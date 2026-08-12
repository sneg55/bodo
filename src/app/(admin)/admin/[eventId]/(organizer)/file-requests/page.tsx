// /admin/[eventId]/file-requests
//
// Ref 30's File Requests list, then the delivery table underneath it, the same stacking the
// Tasks route uses and for the same reason: ref 30 spends its tab strip on the four type tabs,
// so a second tab strip to separate "the requests" from "who has delivered" would move the
// captured tabs down a level, which is the familiarity regression the parity doc outranks
// BUILD_SPEC to prevent.
//
// One file, no `Body` child inside `<Suspense>`: `loading.tsx` renders the same skeleton, and
// the page/body split only earns its keep where a fast header sits in front of a slow read
// (.claude/rules/bodo-conventions.md).

import { FileUpIcon } from 'lucide-react'
import { PageHeader } from '@/components/primitives/PageHeader'
import { isAppError } from '@/constants/errorIds'
import { eventRoleOf } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import { loadFileRequestsAdminView } from '@/features/file-requests/admin-view'
import { loadDeliverables } from '@/features/files/deliverables-read'

import { FileRequestsBoard } from './FileRequestsBoard'

export const metadata = { title: 'File Requests' }

export default async function FileRequestsPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)

  const role = await currentRole(eventId)
  // The layout redirects an unauthorized browser. This is not the security boundary:
  // `createFileRequestAction` and `assignFileRequestsAction` both re-check `admin`.
  if (role === undefined) return null

  // Two loaders over the SAME cached reads, run together: the admin view builds the request
  // cards and the per-speaker roll-up, and this one builds the (speaker, document) pairs the
  // Delivery status table renders. Caching lives in the Airtable client as tagged `fetch`
  // calls, and both loaders issue byte-identical requests, so this costs one set of reads
  // rather than two. See features/files/deliverables-read.ts.
  const [view, deliverables] = await Promise.all([
    loadFileRequestsAdminView(eventId),
    loadDeliverables(eventId),
  ])

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={FileUpIcon}
        title="File Requests"
        // Verbatim off ref 30, including the sentence break the original renders as a
        // dash: "...for download or export" then "they are not attached...".
        description="Collect files (e.g. documents, contracts) from your portals. Uploaded files are stored here for download or export. They are not attached to a submission or contact record."
      />

      <FileRequestsBoard
        eventId={eventId}
        view={view}
        deliverables={deliverables}
        canEdit={role === 'admin'}
      />
    </div>
  )
}

async function currentRole(eventId: string): Promise<string | undefined> {
  try {
    return await eventRoleOf(eventId)
  } catch (error) {
    // Every AUTH_* failure means the layout is about to redirect. Anything else is a real
    // fault and must not be swallowed into an empty screen.
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return undefined
    throw error
  }
}
