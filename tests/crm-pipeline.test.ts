// The sourcing pipeline board's grouping rule.
//
// Pure, so it is assertable without a base. What is pinned: that a contact whose stage column
// was never written is drawn in Prospect (the same fallback the event roster applies, so the
// two surfaces cannot disagree about one cell), that the card still carries the stage AS
// STORED so their first move is a real one, that every column exists whether or not anybody
// is in it, and that a reviewer's cards carry no Move-to menu.

import { describe, expect, it } from 'vitest'
import type { SpeakerStatus } from '@/constants/status'
import { SPEAKER_STATUSES } from '@/constants/status'
import {
  PIPELINE_COLUMN_CAP,
  type PipelineColumn,
  pipelineColumns,
  pipelineStageOf,
} from '@/features/crm/pipeline'
import type { CrmScope } from '@/features/crm/scope'
import type { SpeakerInEvents } from '@/types/crm'

const SCOPE: CrmScope = {
  userId: 'usr1',
  eventIds: ['e1', 'e2'],
  adminEventIds: ['e1'],
  contextEventId: 'e1',
}

/** A viewer who reads both events and can write on neither. */
const REVIEWER: CrmScope = { ...SCOPE, adminEventIds: [] }

const contact = (
  id: string,
  status?: SpeakerStatus,
  eventIds: readonly string[] = ['e1'],
): SpeakerInEvents => ({
  speaker: {
    id,
    email: `${id}@example.com`,
    firstName: 'Ada',
    lastName: id,
    links: {},
    ...(status === undefined ? {} : { status }),
  },
  eventIds: [...eventIds],
})

const columnFor = (columns: readonly PipelineColumn[], status: SpeakerStatus) =>
  columns.find((column) => column.status === status)

describe('pipelineStageOf', () => {
  it('reads the stored stage', () => {
    expect(pipelineStageOf(contact('a', 'confirmed'))).toBe('confirmed')
  })

  it('falls back to prospect for a contact whose column was never written', () => {
    // The same fallback `admin-roster.ts` applies. A person the roster counts under Prospect
    // appearing in a sixth column here would read as two products disagreeing about one cell.
    expect(pipelineStageOf(contact('a'))).toBe('prospect')
  })
})

describe('pipelineColumns', () => {
  it('draws one column per stage, in the vocabulary order, even when empty', () => {
    const columns = pipelineColumns(SCOPE, [])
    expect(columns.map((column) => column.status)).toEqual([...SPEAKER_STATUSES])
    expect(columns.every((column) => column.total === 0)).toBe(true)
  })

  it('puts each contact in the column their stage names', () => {
    const columns = pipelineColumns(SCOPE, [
      contact('a', 'invited'),
      contact('b', 'declined'),
      contact('c', 'invited'),
    ])
    expect(columnFor(columns, 'invited')?.total).toBe(2)
    expect(columnFor(columns, 'declined')?.total).toBe(1)
    expect(columnFor(columns, 'confirmed')?.total).toBe(0)
  })

  it('draws a contact with no stage in Prospect', () => {
    const columns = pipelineColumns(SCOPE, [contact('a')])
    expect(columnFor(columns, 'prospect')?.total).toBe(1)
  })

  it('leaves that card stage undefined, so moving them to Prospect is a real move', () => {
    // The card's stage is what `setSpeakerStageAction` compares against. Reporting `prospect`
    // here would make the contact's first move a no-op that writes nothing to a blank column.
    const card = pipelineColumns(SCOPE, [contact('a')])[0].cards[0]
    expect(card.stage).toBeUndefined()
  })

  it('counts only the events in scope on a card', () => {
    const card = pipelineColumns(SCOPE, [contact('a', 'invited', ['e1', 'e2'])])
    expect(columnFor(card, 'invited')?.cards[0]?.eventCount).toBe(2)
  })

  it('offers a move only on a contact the viewer holds admin on', () => {
    const columns = pipelineColumns(SCOPE, [
      contact('mine', 'invited', ['e1']),
      contact('theirs', 'invited', ['e2']),
    ])
    const cards = columnFor(columns, 'invited')?.cards ?? []
    expect(cards.find((card) => card.id === 'mine')?.editableEventId).toBe('e1')
    // In scope to READ, because `e2` is one of the viewer's events, but not to write: they
    // hold `reviewer` there, so the card carries no Move-to menu.
    expect(cards.find((card) => card.id === 'theirs')?.editableEventId).toBeUndefined()
  })

  it('offers no move at all to a reviewer', () => {
    const columns = pipelineColumns(REVIEWER, [contact('a', 'invited')])
    expect(columnFor(columns, 'invited')?.cards[0]?.editableEventId).toBeUndefined()
  })

  it('caps the cards it draws while still counting everyone', () => {
    const many = Array.from({ length: PIPELINE_COLUMN_CAP + 7 }, (_, index) =>
      contact(`spk${String(index)}`, 'prospect'),
    )
    const column = columnFor(pipelineColumns(SCOPE, many), 'prospect')
    // The total is what the heading shows and what the overflow line subtracts from, so a
    // capped column that also under-counted would tell an organizer the pipeline is smaller
    // than it is.
    expect(column?.total).toBe(PIPELINE_COLUMN_CAP + 7)
    expect(column?.cards).toHaveLength(PIPELINE_COLUMN_CAP)
  })

  it('renders a subtitle for a contact with neither a tagline nor a company', () => {
    // Never blank: a card with a name and an empty second line reads as a rendering bug.
    const card = pipelineColumns(SCOPE, [contact('a', 'prospect')])[0].cards[0]
    expect(card.subtitle).toBe('a@example.com')
  })
})
