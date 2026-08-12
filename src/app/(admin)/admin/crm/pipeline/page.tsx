// /admin/crm/pipeline
//
// The CRM sourcing pipeline as a board. The page authorizes, calls one feature function and
// renders; everything it contains is decided in `src/features/crm/pipeline.ts`, because
// `src/app/**` holds routes only.
//
// THERE IS DELIBERATELY NO `loading.tsx` NEXT TO THIS FILE, and this route is deliberately a
// SIBLING of the `(directory)` group rather than inside it. Both halves are the same rule,
// and it is the one `/admin/crm` learned the hard way (bodo-conventions.md): a route-level
// `loading.tsx` is a `<Suspense>` boundary, and anything under `crm/` that can 404 answers
// HTTP 200 carrying the 404 body once it sits behind one. `crm/(directory)/loading.tsx`
// covers only the directory page inside that group, so it cannot reach this route; adding one
// here would put the layout's `notFound()` for a viewer with no membership behind a boundary,
// and only a status check would ever find it.
//
// The scope is re-derived rather than taken from the layout. In a browser the layout has
// already run, but a layout does not revalidate on every navigation and is not a security
// boundary, so `requireCrmScope()` is called here too and `loadPipelineBoard` intersects
// every read with it.
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe.

import { KanbanIcon } from 'lucide-react'

import { PageHeader } from '@/components/primitives/PageHeader'
import { EnrollContactButton } from '@/features/crm/EnrollContactButton'
import { loadPipelineBoard } from '@/features/crm/pipeline'
import { requireCrmScope } from '@/features/crm/scope'

import { PipelineBoard } from './PipelineBoard'

export default async function CrmPipelinePage() {
  const scope = await requireCrmScope()
  const view = await loadPipelineBoard(scope)

  return (
    <>
      <PageHeader
        icon={KanbanIcon}
        title="Sourcing Pipeline"
        // Says what the columns are and what the scope is, because both are easy to get
        // wrong from the board alone: the stage is the same `Speakers.status` an event's
        // roster filters on, and this surface spans every event the viewer belongs to.
        description={`Every contact across your events, by stage. ${String(view.total)} in total.`}
        // The board's own forward action, and the one it did not have: every contact is drawn
        // in Prospect by default, so until this existed there was no control anywhere on the
        // page that PUT somebody into a stage. Absent for a reviewer, who may read the board
        // and move nobody.
        actions={<EnrollContactButton contacts={view.enrollable} />}
      />
      <PipelineBoard view={view} />
    </>
  )
}
