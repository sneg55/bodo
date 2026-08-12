// Fixtures for the deliverables tables: three requests, two accepted speakers, and a builder
// for one assignment. Shared by files-deliverables.test.ts and files-deliverable-query.test.ts
// so the two cannot drift about what a fixture means.

import type { SpeakerScope } from '@/features/tasks/scope'
import type { FileRequestItem } from '@/services/airtable/reads-requests'
import type { FileRequest } from '@/types/file-requests'

import { CO_SPEAKER, fileRequest, OWNER, requestItem, speaker } from './portal-fakes'

/** Fixed, so `overdue` is a property of the fixture rather than of the day it runs. */
export const NOW = '2026-08-11T12:00:00.000Z'
export const TZ = 'UTC'

/** Required, and its deadline is already past at `NOW`. */
export const RELEASE = fileRequest({
  id: 'recReqRelease',
  entityType: 'contact',
  title: 'Signed speaker release',
  required: true,
  dueAt: '2026-08-01T23:59:59.000Z',
})
/** No deadline at all, which has to render as something other than a blank cell. */
export const BIO = fileRequest({
  id: 'recReqBio',
  entityType: 'contact',
  title: 'Bio as a document',
  required: false,
})
/** Per session, so one speaker with two accepted sessions owes it twice. */
export const SLIDES = fileRequest({
  id: 'recReqSlides',
  entityType: 'submission',
  title: 'Slides',
  required: true,
  dueAt: '2026-09-30T23:59:59.000Z',
})

export const OWNER_SCOPE: SpeakerScope = {
  speaker: speaker({ id: OWNER, firstName: 'Ada', lastName: 'Okafor', email: 'ada@example.com' }),
  submissionIds: ['recSub1', 'recSub2'],
}
export const CO_SCOPE: SpeakerScope = {
  speaker: speaker({ id: CO_SPEAKER, firstName: 'Bo', lastName: 'Lin', email: 'bo@example.com' }),
  submissionIds: ['recSub1'],
}

export const CODES: ReadonlyMap<string, string> = new Map([
  ['recSub1', 'SESS-1'],
  ['recSub2', 'SESS-2'],
])

export function item(input: {
  id: string
  request: FileRequest
  speakerId?: string
  submissionId?: string
  received?: boolean
  receivedAt?: string
}): FileRequestItem {
  return requestItem({
    request: input.request,
    assignment: {
      id: input.id,
      speakerId: input.speakerId ?? OWNER,
      ...(input.submissionId === undefined ? {} : { submissionId: input.submissionId }),
      status: input.received === true ? 'received' : 'pending',
      ...(input.receivedAt === undefined ? {} : { receivedAt: input.receivedAt }),
    },
  })
}
