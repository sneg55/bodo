// `GET /api/v1/events`: the events this token reaches. R10, BUILD_SPEC section 5.9.
//
// This endpoint is not in section 5.9's list of two, and it is here because that list is not
// usable without it: both other routes are addressed by SLUG, and a client that has just been
// handed a token has no way to learn one. Discovery is the difference between an API a
// developer can start with and one that requires somebody to read a URL out of a browser.
//
// A ROUTE HANDLER rather than a page, for the obvious reason, and it authorizes for itself:
// there is no layout above `/api`, and a Route Handler is reachable by anyone who can make an
// HTTP request. BUILD_SPEC section 4.

import { authenticate } from '@/features/api/auth'
import { paginate } from '@/features/api/pagination'
import { readApiEvents } from '@/features/api/reads'
import { apiHandler, jsonPage, unauthorized } from '@/features/api/responses'

export async function GET(request: Request): Promise<Response> {
  return await apiHandler(async () => {
    const caller = await authenticate(request)
    if (caller === undefined) return unauthorized()

    const events = await readApiEvents(caller.eventIds)
    const { searchParams } = new URL(request.url)

    return jsonPage(
      paginate(events, { page: searchParams.get('page'), size: searchParams.get('size') }),
    )
  })
}
