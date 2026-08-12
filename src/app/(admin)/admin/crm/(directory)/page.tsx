// /admin/crm
//
// The cross-event speaker directory. One file, no `XBody.tsx` split: that split buys a
// visitor something only when there is a slow read behind something they could already be
// shown, and this route's own `loading.tsx` renders the header, toolbar and row shapes
// while the read streams.
//
// `(directory)` is a route group, so this file still answers `/admin/crm`. It exists to
// keep the `loading.tsx` beside it OFF the sibling `[speakerId]` route, whose `notFound()`
// answered HTTP 200 with the 404 body while that boundary covered the whole segment. The
// reasoning, and the measurement, are on `loading.tsx`.
//
// `searchParams` is awaited in the body, which is fine and is the default here: the rule
// against it was a `cacheComponents` rule and that flag is off (bodo-conventions.md).
//
// The scope is re-derived rather than taken from the layout. The layout has already
// redirected an anonymous visitor and 404'd a member of nothing, so in a browser this call
// is a formality, but a layout does not revalidate on every navigation and is not a
// security boundary. `requireCrmScope` is the same function every CRM Server Action calls
// for itself.

import { loadCrmDirectory } from '@/features/crm/directory'
import type { RawSearchParams } from '@/features/crm/directory-query'
import { parseCrmQuery } from '@/features/crm/directory-query'
import { requireCrmScope } from '@/features/crm/scope'

import { CrmDirectory } from './CrmDirectory'

export default async function CrmDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const [rawSearchParams, scope] = await Promise.all([searchParams, requireCrmScope()])
  const query = parseCrmQuery(rawSearchParams)

  return <CrmDirectory view={await loadCrmDirectory(scope, query)} query={query} />
}
