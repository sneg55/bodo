// /admin/crm/[speakerId]
//
// One speaker's profile. The page wires `params`, authorizes, calls one feature function
// and renders; everything it contains is decided in `src/features/crm/profile.ts`, because
// `src/app/**` holds routes only.
//
// `params` is awaited in the BODY, which is the default here: the rule against it was a
// `cacheComponents` rule and that flag is off (bodo-conventions.md).
//
// `notFound()` IS ALSO CALLED FROM THE BODY, and that is the load-bearing line in this
// file. A `notFound()` reached from inside a `<Suspense>` boundary renders the 404 page
// after the status line has already gone out, so the response is HTTP 200 carrying the
// 404 body: nothing errors, nothing is disclosed, and only a status check ever finds it.
//
// THERE IS DELIBERATELY NO `loading.tsx` NEXT TO THIS FILE, and that is the other half of
// the same rule. A route-level `loading.tsx` is itself such a boundary, so one here would
// put this `notFound()` behind it however correctly it is placed in the body. Both halves
// were measured on the running server rather than reasoned about: with a `loading.tsx` in
// this folder an unknown id answered 200 with the 404 body, and without it the same
// request answers a real 404 status line. The directory's skeleton survives because it
// moved into the `(directory)` route group; see the header on that file. Same trade the
// speaker portal already made when `(portal)/portal/loading.tsx` was removed
// (bodo-conventions.md), and it costs less here: the admin chrome is in the layout and
// persists across a navigation from the directory row that leads here.
//
// The scope is re-derived rather than taken from the layout. In a browser the layout has
// already run, but a layout does not revalidate on every navigation and is not a security
// boundary, so `requireCrmScope()` is called here too and `loadSpeakerProfile` intersects
// every read with it.

import { notFound } from 'next/navigation'

import { loadSpeakerProfile } from '@/features/crm/profile'
import { requireCrmScope } from '@/features/crm/scope'

import { SpeakerProfile } from './SpeakerProfile'

export default async function SpeakerProfilePage({
  params,
}: {
  params: Promise<{ speakerId: string }>
}) {
  const [{ speakerId }, scope] = await Promise.all([params, requireCrmScope()])

  const view = await loadSpeakerProfile(scope, speakerId)
  // A speaker who does not exist and a speaker on somebody else's event answer the same
  // way on purpose: telling the two apart would confirm that a guessed id is real.
  if (view === undefined) notFound()

  return <SpeakerProfile view={view} />
}
