// Fixtures for the ⌘K palette's tests, in the shape `tests/helpers/team-fakes.ts` uses.
//
// Extracted from tests/global-search.test.ts when that file passed the 300 line limit. They
// are here rather than inline because they are the SAME three records the palette's result
// rules and its overflow rules both need, and two private copies of "what a submission looks
// like" drift the first time a required field is added to the domain type.

import type { Speaker, SubmissionWithParticipants } from '@/types/domain'
import type { GlobalSearchGroup, GlobalSearchItem } from '@/types/search'

export const EVENT = 'recEvent1'

export function speaker(overrides: Partial<Speaker> = {}): Speaker {
  return {
    id: 'recSpk1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    links: {},
    ...overrides,
  }
}

export function submission(
  overrides: Partial<SubmissionWithParticipants> = {},
): SubmissionWithParticipants {
  return {
    id: 'recSub1',
    eventId: EVENT,
    submitterId: 'recSpk1',
    code: 'SESS-14',
    title: 'Scaling inference on a budget',
    status: 'pending',
    source: 'form',
    reviewRequired: true,
    answers: {},
    tagIds: [],
    scheduleStatus: 'unscheduled',
    contentStatus: 'not_submitted',
    calendarSequence: 0,
    calendarStatus: 'active',
    participants: [],
    ...overrides,
  }
}

export function participant(speakerOverrides: Partial<Speaker> = {}) {
  return {
    id: 'recPart1',
    submissionId: 'recSub1',
    speakerId: 'recSpk1',
    role: 'speaker' as const,
    isPrimary: true,
    sortOrder: 0,
    speaker: speaker(speakerOverrides),
  }
}

/** The items of one group, or none, so a missing group reads as an empty list. */
export function itemsOf(
  groups: readonly GlobalSearchGroup[],
  id: string,
): readonly GlobalSearchItem[] {
  return groups.find((group) => group.id === id)?.items ?? []
}
