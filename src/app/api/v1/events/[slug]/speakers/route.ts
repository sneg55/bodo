// `GET /api/v1/events/{slug}/speakers`: the announced lineup. R10, BUILD_SPEC section 5.9.
//
// Speakers on the PUBLISHED schedule, not the full roster, and `readApiSpeakers` carries the
// reasoning: an unannounced lineup is protected by the sessions endpoint, and a roster here
// would hand back the same secret through a different door.
//
// The response carries no email and no phone. `apiSpeaker` says why, and Sessionize's public
// speaker object makes the same call (BUILD_SPEC:658).

import { authenticate } from '@/features/api/auth'
import { paginate } from '@/features/api/pagination'
import { readApiEvent, readApiSpeakers } from '@/features/api/reads'
import { apiHandler, jsonPage, notFound, unauthorized } from '@/features/api/responses'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return await apiHandler(async () => {
    const caller = await authenticate(request)
    if (caller === undefined) return unauthorized()

    const { slug } = await params
    const event = await readApiEvent(slug, caller.eventIds)
    if (event === undefined) return notFound(`no event with slug ${slug}`)

    const speakers = await readApiSpeakers(event.id)
    const { searchParams } = new URL(request.url)

    return jsonPage(
      paginate(speakers, { page: searchParams.get('page'), size: searchParams.get('size') }),
    )
  })
}
