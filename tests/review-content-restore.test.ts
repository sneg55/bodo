// Putting a prior version of a session's content back. CNT-11.
//
// The history panel could always say what changed, from what, by whom. Nothing could act
// on it, so the two things worth pinning here are the two that make restore an audit trail
// rather than a rewind:
//
//   1. A restore is a SAVE of the old value. It goes back through `prepareContentEdit`,
//      so it is validated identically and it produces a change list, which is what the
//      action then appends as a new history row. A restore that wrote the record directly
//      would leave the panel showing an edit nobody could account for.
//   2. It touches ONE field. Restoring a title must carry the abstract through untouched,
//      because the two are written in the same call and the loser of that bug is the field
//      the organizer was not looking at.

import { describe, expect, it } from 'vitest'

import {
  formatRevisionStamp,
  prepareContentEdit,
  restorePayload,
} from '@/features/review/content-edit'
import type { SubmissionWithParticipants } from '@/types/domain'

import { syncErrorIdOf } from './helpers/auth-fakes'

/** A session entered by hand, so its abstract lives under the registry key. */
function submission(overrides: Partial<SubmissionWithParticipants> = {}) {
  return {
    id: 'sub1',
    eventId: 'ev1',
    submitterId: 'spk1',
    code: 'SESS-1',
    title: 'Agents that actually ship',
    status: 'accepted',
    source: 'manual',
    reviewRequired: false,
    answers: { description: 'The abstract as it stands.', notes: 'Prefer the morning' },
    tagIds: [],
    scheduleStatus: 'unscheduled',
    contentStatus: 'not_submitted',
    participants: [],
    ...overrides,
  } as SubmissionWithParticipants
}

describe('restorePayload', () => {
  it('puts a title back and carries the current abstract through', () => {
    const target = restorePayload({
      revision: { fieldLabel: 'Title', previousValue: 'Agents that ship' },
      currentTitle: 'Agents that actually ship',
      currentAbstract: 'The abstract as it stands.',
    })

    expect(target).toEqual({
      field: 'Title',
      title: 'Agents that ship',
      abstract: 'The abstract as it stands.',
    })
  })

  it('puts an abstract back and carries the current title through', () => {
    const target = restorePayload({
      revision: { fieldLabel: 'Abstract', previousValue: 'The original abstract.' },
      currentTitle: 'Agents that actually ship',
      currentAbstract: 'The abstract as it stands.',
    })

    expect(target).toEqual({
      field: 'Abstract',
      title: 'Agents that actually ship',
      abstract: 'The original abstract.',
    })
  })

  it('refuses a field label it does not recognise', () => {
    // `ContentRevisions` is visible in the Airtable grid and a row typed straight into it
    // can carry anything. Guessing which column "Titel" meant would put a stranger's text
    // into the record.
    expect(
      syncErrorIdOf(() =>
        restorePayload({
          revision: { fieldLabel: 'Titel', previousValue: 'whatever' },
          currentTitle: 'Agents that actually ship',
          currentAbstract: 'The abstract as it stands.',
        }),
      ),
    ).toBe('E_SUB_003')
  })

  it('is refused rather than half-applied when the label is empty', () => {
    // A blank row, which is what pressing `+` in the Airtable grid creates.
    expect(
      syncErrorIdOf(() =>
        restorePayload({
          revision: { fieldLabel: '', previousValue: '' },
          currentTitle: 'Agents that actually ship',
          currentAbstract: 'The abstract as it stands.',
        }),
      ),
    ).toBe('E_SUB_003')
  })
})

describe('a restore fed back through the editor', () => {
  it('records the reverse change, so history is appended and not rewound', () => {
    const target = restorePayload({
      revision: { fieldLabel: 'Abstract', previousValue: 'The original abstract.' },
      currentTitle: 'Agents that actually ship',
      currentAbstract: 'The abstract as it stands.',
    })

    const { changes, edit } = prepareContentEdit({
      submission: submission(),
      form: undefined,
      title: target.title,
      abstract: target.abstract,
    })

    // One row, pointing from what is on the record NOW to what is being put back. That is
    // what the action writes to `ContentRevisions`, which is why restoring never deletes
    // the entries that came after the one being restored.
    expect(changes).toEqual([
      { field: 'Abstract', from: 'The abstract as it stands.', to: 'The original abstract.' },
    ])
    // And the other answers survive, because the writer replaces `answersJson` wholesale.
    expect(edit.answers).toEqual({
      description: 'The original abstract.',
      notes: 'Prefer the morning',
    })
    expect(edit.title).toBe('Agents that actually ship')
  })

  it('changes nothing when the version being restored is already the current one', () => {
    const target = restorePayload({
      revision: { fieldLabel: 'Title', previousValue: 'Agents that actually ship' },
      currentTitle: 'Agents that actually ship',
      currentAbstract: 'The abstract as it stands.',
    })

    const { changes } = prepareContentEdit({
      submission: submission(),
      form: undefined,
      title: target.title,
      abstract: target.abstract,
    })

    // The action turns this into "That version is already the current one" and writes
    // nothing. A history row saying a field changed from a value to itself is noise that
    // the next person has to read past.
    expect(changes).toEqual([])
  })

  it('validates a restored title like any other, so a bad row cannot bypass the cap', () => {
    const target = restorePayload({
      revision: { fieldLabel: 'Title', previousValue: '   ' },
      currentTitle: 'Agents that actually ship',
      currentAbstract: 'The abstract as it stands.',
    })

    expect(
      syncErrorIdOf(() =>
        prepareContentEdit({
          submission: submission(),
          form: undefined,
          title: target.title,
          abstract: target.abstract,
        }),
      ),
    ).toBe('E_SUB_003')
  })
})

describe('formatRevisionStamp', () => {
  it('carries the time of day, not just the date', () => {
    // The rubric asks for timestamps including time of day, and a date alone cannot tell
    // two edits made in the same afternoon apart.
    expect(formatRevisionStamp('2026-08-10T12:52:00.000Z')).toBe('Aug 10, 2026, 12:52 PM')
  })

  it('reads in UTC rather than the machine timezone', () => {
    // The history says when somebody typed, which is not an event-local fact and must not
    // be a test-runner-local one either.
    expect(formatRevisionStamp('2026-08-10T23:30:00.000Z')).toBe('Aug 10, 2026, 11:30 PM')
  })

  it('shows an unparseable stamp rather than Invalid Date', () => {
    // Tolerant readers all the way down: the column is free text in the Airtable grid.
    expect(formatRevisionStamp('not a date')).toBe('not a date')
  })
})
