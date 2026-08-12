// Everything under the admin tree that is the ORGANIZER's, as opposed to the reviewer's.
//
// A route group, so no URL changes: `(organizer)` is invisible to the router and every
// page below it keeps the path it had. What it buys is one place to answer "is this
// surface admin-only", instead of the same three lines repeated in eighteen page bodies
// and forgotten in the nineteenth.
//
// It exists because a reviewer could read all of it. The parent layout admits any
// membership on the event (`role === undefined` is the only rejection), and
// `abstracts/page.tsx` and its two siblings checked only that a role was defined and
// never that it was `admin`. So a `reviewer` membership rendered the whole organizer
// sidebar and the entire abstracts list, including every submission they were not
// assigned to. Writes were never at risk, since each Server Action authorizes for
// itself, but the reads and the navigation were.
//
// Which side of the line each route sits on:
//   - `evaluation/` stays OUTSIDE this group. It is the reviewer's queue, and
//     `requireEventRole(eventId, 'reviewer')` inside it already ranks `admin` above
//     `reviewer`, so an organizer still sees their own queue plus the assignment panel.
//   - everything else moved in, the dashboard landing page included, because a reviewer
//     has no business in any of it.
//
// It RENDERS a refusal rather than redirecting, and that is not a style choice. This
// layout sits below `[eventId]/loading.tsx`, which is a Suspense boundary, and a
// `redirect()` that resolves after the shell has flushed never produces a response: on
// Workers that is a hung request the runtime cancels, which the visitor sees as a 500.
// `notFound()` fails more quietly and just as wrongly, answering HTTP 200 with the 404
// body. So the deny path is a rendered notice, which also gives the reviewer the one
// link they actually want.
//
// This is NOT the security boundary, for the usual reason: a Server Action is reachable
// by POST without any of this rendering, so every action underneath still calls
// `requireEventRole(eventId, 'admin')` for itself. BUILD_SPEC section 4.

import type { ReactNode } from 'react'

import { isTeamOrganizer } from '@/features/team/authorize'
import { ReviewerAccessCard } from '@/features/team/ReviewerAccessCard'

export default async function OrganizerLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = await params

  if (await isTeamOrganizer(eventId)) return await children

  return <ReviewerAccessCard eventId={eventId} />
}
