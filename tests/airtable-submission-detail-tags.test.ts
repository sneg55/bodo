// What `getSubmission` subscribes to, request by request.
//
// It is three requests, not one, and they are not the same shape. The RECORD read is
// addressed by id, so its URL is unique to this submission and `submission:{id}` is exactly
// right for it. The two CAST reads page the WHOLE of `SubmissionParticipants` and the WHOLE
// of `Speakers`, and that changes both halves of the question:
//
//   - The DATA. Writes that change those rows do not all name this submission.
//     `saveSpeakerProfile` expires `speaker:{id}`, `event:{id}:speakers` and
//     `event:{id}:submissions`, precisely because "submission rows carry the resolved cast";
//     `upsertSpeakerByEmail` expires the first two. Under `submission:{id}` alone, none of
//     them reached this page and a renamed speaker kept their old name on it.
//   - The CACHE KEY. A bare `listAll` puts no filter, no sort and no field list on the
//     request, so these two are byte-identical to the ones `listSubmissionsForEvents` issues,
//     and Next keys a Data Cache entry on the request rather than on the tags. One entry
//     serves both reads, and two callers declaring DIFFERENT tags over one key is its own
//     bug: on the file-system cache a reader whose tags do not match the stored ones rewrites
//     the entry with its own and does not refetch, which moves `lastModified` past an expiry
//     the other caller had already recorded and hides it.
//
// So the assertion is not merely "the cast reads are tagged". It is that they are tagged
// IDENTICALLY to the other caller of the same cache key, which is what the last test here
// pins by comparing the two reads directly.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { REVALIDATE } from '@/services/airtable/read-cache'

type Call = { url: string; init: RequestInit }

const ORIGINAL_ENV = { ...process.env }

const SUBMISSION = {
  id: 'recS1',
  fields: {
    event: ['recE1'],
    submitter: ['recSpk1'],
    code: 1,
    title: 'Evaluating agents without a golden dataset',
    status: 'accepted',
  },
}

/**
 * Load the live reads with credentials configured and `fetch` captured.
 *
 * Credentials matter: with none, `getSource()` serves fixtures and never issues a request,
 * so a test that skipped this would assert nothing at all.
 */
async function loadReads(): Promise<{
  calls: Call[]
  reads: typeof import('@/services/airtable/reads')
}> {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()

  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} })
    return Promise.resolve(
      new Response(
        JSON.stringify(url.includes('/Submissions/rec') ? SUBMISSION : { records: [] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
  })

  return { calls, reads: await import('@/services/airtable/reads') }
}

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

const CAST_TAGS = [
  'event:recE1:submissions',
  'event:recE1:agenda',
  'event:recE1:agenda:published',
  'event:recE1:speakers',
]

/** The two whole-table cast reads, in the order `loadCast` issues them. */
function castCalls(calls: readonly Call[]): readonly Call[] {
  return calls.filter(
    (call) => call.url.includes('/SubmissionParticipants?') || call.url.includes('/Speakers?'),
  )
}

describe('getSubmission', () => {
  it('tags the record read on the submission alone', async () => {
    const { reads, calls } = await loadReads()

    await reads.getSubmission('recS1')

    const record = calls.find((call) => call.url.includes('/Submissions/rec'))
    expect(record?.init.next).toEqual({
      revalidate: REVALIDATE.edited,
      tags: ['submission:recS1'],
    })
  })

  it('subscribes the cast reads to the event, not to the submission', async () => {
    const { reads, calls } = await loadReads()

    await reads.getSubmission('recS1')

    const cast = castCalls(calls)
    expect(cast).toHaveLength(2)
    for (const call of cast) {
      expect(call.init.next).toEqual({ revalidate: REVALIDATE.edited, tags: CAST_TAGS })
      // The narrow tag on its own was the defect: a speaker write never names it, so a
      // renamed or newly created speaker did not reach this page.
      expect(call.init.next?.tags).not.toContain('submission:recS1')
    }
  })

  it('issues the cast reads under the same URL AND the same tags as the list read', async () => {
    // Same URL is what makes them one Data Cache entry; same tags is what makes that entry
    // safe. Asserting only one of the two would miss the bug entirely.
    const detail = await loadReads()
    await detail.reads.getSubmission('recS1')
    const fromDetail = castCalls(detail.calls)

    const list = await loadReads()
    await list.reads.listSubmissions('recE1')
    const fromList = castCalls(list.calls)

    expect(fromDetail.map((call) => call.url)).toEqual(fromList.map((call) => call.url))
    expect(fromDetail.map((call) => call.init.next)).toEqual(fromList.map((call) => call.init.next))
  })

  it('sends a bare list with no filter, sort or field list, which is why the keys collide', async () => {
    // The premise of the test above, asserted rather than assumed: if `listParams` ever
    // starts distinguishing these requests, the two reads stop sharing an entry and the
    // tag-matching rule above becomes optional rather than load-bearing.
    const { reads, calls } = await loadReads()

    await reads.getSubmission('recS1')

    for (const call of castCalls(calls)) {
      const query = new URL(call.url).searchParams
      expect([...query.keys()]).toEqual(['pageSize'])
    }
  })
})
