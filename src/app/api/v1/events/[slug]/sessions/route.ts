// `GET /api/v1/events/{slug}/sessions`: the published schedule. R10, BUILD_SPEC section 5.9.
//
// **Published rows only**, which is not this file's decision to make or to forget:
// `readApiSessions` composes `listPublishedAgenda`, the one read that applies the published,
// accepted, uncancelled and content-approved gate. BUILD_SPEC:984 binds this endpoint to that
// rule alongside the embeds, and the reason it is enforced a layer down is that a route which
// reached for `listSubmissions` instead would expose a half-built agenda and look identical
// in review.

import { authenticate } from '@/features/api/auth'
import { paginate } from '@/features/api/pagination'
import { readApiEvent, readApiSessions } from '@/features/api/reads'
import { apiHandler, jsonPage, notFound, unauthorized } from '@/features/api/responses'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return await apiHandler(async () => {
    const caller = await authenticate(request)
    if (caller === undefined) return unauthorized()

    const { slug } = await params
    // 404 covers both "no such event" and "not one of yours". See `notFound` for why the
    // second is not a 403.
    const event = await readApiEvent(slug, caller.eventIds)
    if (event === undefined) return notFound(`no event with slug ${slug}`)

    const sessions = await readApiSessions(event.id)
    const { searchParams } = new URL(request.url)

    return jsonPage(
      paginate(sessions, { page: searchParams.get('page'), size: searchParams.get('size') }),
    )
  })
}
