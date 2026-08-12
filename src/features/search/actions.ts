'use server'

// The one read behind ⌘K.
//
// **Why an action and not a prop on the layout.** The obvious wiring is for
// `AdminTopBarSlot` to read submissions and speakers and hand the palette a ready index.
// That was rejected twice over: the layout comment in `(admin)/admin/[eventId]/layout.tsx`
// says the top bar reads nothing and cannot suspend, and making it read would put the
// admin chrome behind a Suspense boundary on every single admin page load; and the index
// would then be serialized into the RSC payload of every one of those pages whether or not
// anybody pressed a key. An action moves both costs to the first keystroke, which is the
// only moment either is worth paying.
//
// **It is cheap on the second keystroke and after.** `listSubmissions` and `listSpeakers`
// are tagged `fetch` reads (`read-cache.ts`), so the debounced calls behind a query being
// typed out hit the cache rather than Airtable. That is what makes filtering server-side
// affordable at all, and it is why this does not try to push the query into Airtable's own
// filterByFormula: a formula search would be an uncacheable read per keystroke.
//
// **`reviewer`, not `admin`.** A reviewer already reads the Abstracts list this palette
// links into, so refusing them search would hide data they can see by scrolling. Both
// destinations are read-only surfaces and this action writes nothing.

import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import {
  globalSearchGroups,
  MIN_QUERY_LENGTH,
  normalizeQuery,
} from '@/features/search/global-search'
import { listSpeakers, listSubmissions } from '@/services/airtable/queries'
import type { GlobalSearchGroup } from '@/types/search'

export async function globalSearchAction(input: {
  eventId: string
  query: string
}): Promise<ActionResult<{ groups: readonly GlobalSearchGroup[] }>> {
  try {
    // Before the reads, so a caller probing another event's id cannot use response
    // timing to learn whether it has submissions.
    await requireEventRole(input.eventId, 'reviewer')

    // Checked here as well as in `globalSearchGroups`, because this is the check that
    // stops the reads. The pure function returning `[]` for a short query would still
    // have paid for two list reads to do it.
    if (normalizeQuery(input.query).length < MIN_QUERY_LENGTH) return actionOk({ groups: [] })

    const [submissions, speakers] = await Promise.all([
      listSubmissions(input.eventId),
      listSpeakers(input.eventId),
    ])

    return actionOk({
      groups: globalSearchGroups({
        eventId: input.eventId,
        submissions,
        speakers,
        query: input.query,
      }),
    })
  } catch (error) {
    return actionFailure(error)
  }
}
