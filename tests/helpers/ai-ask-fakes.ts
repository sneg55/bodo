// Rows for the ⌘K ask tests. Not a test file (vitest only collects `tests/**/*.test.ts`),
// just the fixtures those tests share.
//
// Deliberately the same shapes `global-search.test.ts` uses, because the ask resolves its
// refs through the same href builders: a fixture that drifted from that one would let the
// two surfaces disagree about where a submission lives without anything failing.

import type { Event, Speaker, SubmissionWithParticipants } from '@/types/domain'

export const EVENT_ID = 'recEvent1'

export const EVENT_ROW: Event = {
  id: EVENT_ID,
  name: 'AI.Engineer Sandbox Event - NYC',
  slug: 'ai-engineer-sandbox-event',
  eventType: 'conference',
  timezone: 'America/New_York',
  status: 'open',
  accelSyncEnabled: false,
}

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
    eventId: EVENT_ID,
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

/** `n` submissions with distinct ids and codes, for the cap and truncation cases. */
export function submissions(count: number): readonly SubmissionWithParticipants[] {
  return Array.from({ length: count }, (_, index) =>
    submission({ id: `recSub${index}`, code: `SESS-${index}` }),
  )
}
