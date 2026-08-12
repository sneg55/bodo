// The one rule that decides what stage a contact is SHOWN as.
//
// It exists because the pipeline board broke it: a contact with no stage stored sat in the
// Prospect column, was counted in that column's total, and carried a Move-to trigger reading
// `No stage`. What is pinned here is that the column and the card now come from the same
// function, and that the STORED value is left alone so the first move is still a real one.

import { describe, expect, it } from 'vitest'
import { pipelineColumns, pipelineStageOf } from '@/features/crm/pipeline'
import type { CrmScope } from '@/features/crm/scope'
import { displayStage, isStageMove, stageLabel } from '@/features/crm/stage-history'
import type { SpeakerInEvents } from '@/types/crm'

const SCOPE: CrmScope = {
  userId: 'usr1',
  eventIds: ['e1'],
  adminEventIds: ['e1'],
  contextEventId: 'e1',
}

const stageless: SpeakerInEvents = {
  speaker: {
    id: 'spk1',
    email: 'a@example.com',
    firstName: 'Rea',
    lastName: 'Acceptance',
    links: {},
  },
  eventIds: ['e1'],
}

describe('displayStage', () => {
  it('reads a stored stage back unchanged', () => {
    expect(displayStage('invited')).toBe('invited')
  })

  it('shows a contact with no stage as Prospect, which is the column they are counted in', () => {
    expect(displayStage(undefined)).toBe('prospect')
  })
})

describe('the board and the card agree', () => {
  it('files a stage-less contact under the column their own trigger names', () => {
    const column = pipelineColumns(SCOPE, [stageless]).find(
      (candidate) => candidate.status === pipelineStageOf(stageless),
    )
    expect(column?.status).toBe('prospect')
    expect(column?.total).toBe(1)
    // What the trigger renders. Before the fix this was `No stage` beside a Prospect heading.
    expect(displayStage(column?.cards[0]?.stage)).toBe(column?.status)
  })

  it('still leaves the stored stage absent, so their first move writes and is logged', () => {
    const card = pipelineColumns(SCOPE, [stageless])[0].cards[0]
    expect(card.stage).toBeUndefined()
    expect(isStageMove(card.stage, 'prospect')).toBe(true)
    // The history keeps the distinction the card no longer shows: a log row says what was
    // stored at the time.
    expect(stageLabel('')).toBe('No stage')
  })
})
