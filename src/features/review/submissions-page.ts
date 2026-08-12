// What the three SUBMISSIONS routes have in common, which is everything except the scope.
//
// It lived inside `abstracts/page.tsx` while Abstracts was the only surface of its kind.
// View All and Sessions are the same read through `submission-scope.ts`, so the saved-view
// resolution, the role check and the query parse move here rather than being copied twice:
// three copies of the pristine-visit rule below is three chances for one of them to stop
// applying a default view.

import { isAppError } from '@/constants/errorIds'
import { eventRoleOf } from '@/features/auth/wiring'
import type { AbstractsQueryState } from '@/features/review/abstracts-query'
import {
  hasQueryState,
  parseAbstractsQuery,
  type RawSearchParams,
} from '@/features/review/abstracts-query'
import { type AbstractsView, loadAbstractsView } from '@/features/review/abstracts-view'
import type { SubmissionScope } from '@/features/review/submission-scope'
import { defaultSavedView } from '@/features/views/saved-view-model'
import { listSavedViews } from '@/services/airtable/queries'
import { ABSTRACTS_SURFACE, type SavedView } from '@/types/saved-views'

/**
 * All three surfaces store their views under the `abstracts` surface, deliberately.
 *
 * They render one column set over one row model, so a view saved on Abstracts restores
 * cleanly on Sessions and on View All. The other candidate, the `sessions` surface, is
 * already taken by the Agenda List (`AGENDA_LIST_SURFACE`), whose columns are a different
 * set: sharing with it would offer an organizer views that half apply.
 */
const SURFACE = ABSTRACTS_SURFACE

export type SubmissionsSurfaceProps = {
  readonly eventId: string
  readonly view: AbstractsView
  readonly query: AbstractsQueryState
  readonly savedViews: readonly SavedView[]
  readonly openingView?: SavedView
  readonly canEdit: boolean
  readonly scope: SubmissionScope
}

/**
 * Everything the table needs, or `undefined` when there is no role to read it with.
 *
 * `undefined` rather than a redirect: the layout is what redirects an unauthorized browser
 * to the login page, and a redirect from here would run inside the route's own Suspense
 * boundary, which on Workers produces no response at all.
 */
export async function loadSubmissionsSurface(input: {
  eventId: string
  searchParams: RawSearchParams
  scope: SubmissionScope
}): Promise<SubmissionsSurfaceProps | undefined> {
  const role = await currentRole(input.eventId)
  if (role === undefined) return undefined

  const parsed = parseAbstractsQuery(input.searchParams)

  // The saved-views read is started first and awaited early only on a PRISTINE visit, where
  // the default view decides the sort and filters the table read is about to run. A visit
  // that carries its own state in the URL never waits for it: the same promise is joined at
  // the end, so either path costs one saved-views read and the slow table read overlaps it.
  //
  // The default is applied server side rather than by a navigation on mount. A client
  // round trip there would repaint the table twice and would fight a shared, filtered link,
  // which is the whole reason this surface keeps its query in the URL.
  const savedViewsRead = listSavedViews(input.eventId, SURFACE)
  const opening = hasQueryState(input.searchParams)
    ? undefined
    : defaultSavedView(await savedViewsRead)
  const query =
    opening === undefined ? parsed : { ...parsed, sort: opening.sort, filters: opening.filters }

  const [view, savedViews] = await Promise.all([
    loadAbstractsView(input.eventId, query, input.scope),
    savedViewsRead,
  ])

  return {
    eventId: input.eventId,
    view,
    query,
    savedViews,
    ...(opening === undefined ? {} : { openingView: opening }),
    // A reviewer reads this table. Hiding the controls is a courtesy; the actions
    // themselves require `admin`, so a reviewer cannot change a status either way.
    canEdit: role === 'admin',
    scope: input.scope,
  }
}

async function currentRole(eventId: string): Promise<string | undefined> {
  try {
    return await eventRoleOf(eventId)
  } catch (error) {
    // Every AUTH_* failure means the same thing here: the layout is about to redirect.
    // Anything else is a real fault and must not be swallowed into an empty screen.
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return undefined
    throw error
  }
}
