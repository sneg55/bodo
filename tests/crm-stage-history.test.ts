// The pipeline stage as a rule: what counts as a move, what one move records, and how a
// recorded move renders.
//
// Pure, so it is assertable without a base and without a clock. The rules worth pinning are
// the ones an append-only log cannot take back if they are wrong: that moving a contact to
// the stage they are already on writes NOTHING, that a contact with no stage has a real
// first move rather than a missing one, and that a status retired from the vocabulary still
// renders as something.

import { describe, expect, it } from 'vitest'

import {
  asSpeakerStatus,
  isStageMove,
  NO_STAGE_LABEL,
  stageChangeDraft,
  stageHistoryRows,
  stageLabel,
} from '@/features/crm/stage-history'
import type { SpeakerStageChange } from '@/services/airtable/speaker-stage-history'

const AT = '2026-03-04T09:30:00.000Z'

const change = (over: Partial<SpeakerStageChange> = {}): SpeakerStageChange => ({
  id: 'sch1',
  speakerId: 'spk1',
  from: 'prospect',
  to: 'invited',
  authorName: 'Ada Okafor',
  at: AT,
  ...over,
})

describe('asSpeakerStatus', () => {
  it('accepts a stage in the closed vocabulary', () => {
    expect(asSpeakerStatus('confirmed')).toBe('confirmed')
  })

  it('refuses anything else rather than coercing it', () => {
    // An unrecognised value written into a single-select column is a 422 that rejects the
    // whole record, which is why the action narrows before it writes.
    expect(asSpeakerStatus('Confirmed')).toBeUndefined()
    expect(asSpeakerStatus('shortlisted')).toBeUndefined()
    expect(asSpeakerStatus('')).toBeUndefined()
  })
})

describe('isStageMove', () => {
  it('is false for the stage the contact is already on', () => {
    expect(isStageMove('invited', 'invited')).toBe(false)
  })

  it('is true between two different stages', () => {
    expect(isStageMove('invited', 'confirmed')).toBe(true)
  })

  it('is true out of no stage at all, so a first move is recorded', () => {
    expect(isStageMove(undefined, 'prospect')).toBe(true)
  })
})

describe('stageChangeDraft', () => {
  const base = { speakerId: 'spk1', authorName: 'Ada Okafor', at: AT }

  it('records who, when, from and to', () => {
    expect(stageChangeDraft({ ...base, from: 'prospect', to: 'invited' })).toEqual({
      speakerId: 'spk1',
      from: 'prospect',
      to: 'invited',
      authorName: 'Ada Okafor',
      at: AT,
    })
  })

  it('is undefined when nothing moved, so the log gains no row', () => {
    // The whole reason this returns a draft rather than writing: a menu that offers every
    // stage will be clicked on the current one, and an append-only log cannot un-say it.
    expect(stageChangeDraft({ ...base, from: 'invited', to: 'invited' })).toBeUndefined()
  })

  it('stores the empty string for a contact who had no stage', () => {
    // Not absent: a missing value on a log row is indistinguishable from a column that
    // failed to write, and `mapSpeakerStageChange` reads it back the same way.
    expect(stageChangeDraft({ ...base, from: undefined, to: 'prospect' })?.from).toBe('')
  })
})

describe('stageLabel', () => {
  it('renders a known stage with the label the roster already draws', () => {
    expect(stageLabel('confirmed')).toBe('Confirmed')
  })

  it('names the empty stage rather than rendering a blank', () => {
    expect(stageLabel('')).toBe(NO_STAGE_LABEL)
  })

  it('passes a retired stage through, because it still happened', () => {
    // The column is text and not a select on purpose: a history records the vocabulary as
    // it WAS, and a row naming a stage since removed must still be readable.
    expect(stageLabel('shortlisted')).toBe('shortlisted')
  })
})

describe('stageHistoryRows', () => {
  it('keeps the order it was handed, which is newest first from the read', () => {
    const rows = stageHistoryRows(
      [change({ id: 'a' }), change({ id: 'b', at: '2026-01-01T00:00:00.000Z' })],
      'UTC',
    )
    expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('formats the timestamp on the server, in the timezone it is given', () => {
    const [utc] = stageHistoryRows([change()], 'UTC')
    const [tokyo] = stageHistoryRows([change()], 'Asia/Tokyo')
    expect(utc.atText).not.toBe('')
    // Same instant, two zones, two strings: this is what a client formatting it itself
    // would get wrong, which is a hydration mismatch on a list of nothing but dates.
    expect(tokyo.atText).not.toBe(utc.atText)
  })

  it('leaves the timestamp empty for a row whose instant cannot be parsed', () => {
    // `dateTimeText` answers '' for an unreadable value rather than throwing, and the panel
    // drops the separator rather than rendering a hanging dot.
    expect(stageHistoryRows([change({ at: 'not a date' })], 'UTC')[0]?.atText).toBe('')
  })

  it('carries the author through, because attribution is the point of the log', () => {
    expect(stageHistoryRows([change()], 'UTC')[0]?.authorName).toBe('Ada Okafor')
  })

  it('is empty for a contact nobody has moved', () => {
    expect(stageHistoryRows([], 'UTC')).toEqual([])
  })
})
