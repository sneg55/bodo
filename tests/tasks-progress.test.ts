// The "1/3 done" arithmetic, including every way it could read wrong.

import { describe, expect, it } from 'vitest'

import { progressTotals, speakerProgress, withOutstanding } from '@/features/tasks/progress'
import type { SpeakerScope } from '@/features/tasks/scope'
import { mapTaskAssignment, mapTaskAssignmentIfIntact } from '@/services/airtable/mapping-portal'
import type { TaskAssignmentItem } from '@/services/airtable/reads-portal'

import { assignment, CO_SPEAKER, OWNER, STRANGER, speaker, task } from './helpers/portal-fakes'

const headshot = task({ id: 'recTaskHeadshot', entityType: 'contact', title: 'Upload a headshot' })
const travel = task({ id: 'recTaskTravel', entityType: 'contact', title: 'Confirm your travel' })
const slides = task({ id: 'recTaskSlides', entityType: 'submission', title: 'Upload your slides' })

const owner: SpeakerScope = {
  speaker: speaker({ id: OWNER, firstName: 'Ada', lastName: 'Okafor' }),
  submissionIds: ['recSub1'],
}
const co: SpeakerScope = {
  speaker: speaker({ id: CO_SPEAKER, firstName: 'Bo', lastName: 'Lin' }),
  submissionIds: ['recSub1'],
}

function item(overrides: {
  id: string
  task: typeof headshot
  speakerId?: string
  submissionId?: string
  done?: boolean
}): TaskAssignmentItem {
  return {
    task: overrides.task,
    assignment: assignment({
      id: overrides.id,
      taskId: overrides.task.id,
      speakerId: overrides.speakerId ?? OWNER,
      submissionId: overrides.submissionId,
      status: overrides.done === true ? 'done' : 'pending',
    }),
  }
}

const checklist: readonly TaskAssignmentItem[] = [
  item({ id: 'recAsg1', task: headshot }),
  item({ id: 'recAsg2', task: travel }),
  item({ id: 'recAsg3', task: slides, submissionId: 'recSub1' }),
]

describe('speakerProgress', () => {
  it('reads 0/3 before anything is done and 1/3 after one completion', () => {
    expect(speakerProgress({ scopes: [owner], items: checklist })[0]).toMatchObject({
      label: '0/3',
      done: 0,
      outstanding: 3,
      percent: 0,
    })

    const oneDone = [item({ id: 'recAsg1', task: headshot, done: true }), ...checklist.slice(1)]
    expect(speakerProgress({ scopes: [owner], items: oneDone })[0]).toMatchObject({
      label: '1/3',
      done: 1,
      outstanding: 2,
      percent: 33,
    })
  })

  it('reads 0/0 at 0 per cent for a speaker with nothing assigned', () => {
    // `percent: 0` is the assertion that the zero denominator did not produce NaN: NaN
    // would not match 0, and a progress bar fed NaN renders nothing at all.
    expect(speakerProgress({ scopes: [co], items: checklist })[0]).toMatchObject({
      label: '0/0',
      assigned: 0,
      done: 0,
      outstanding: 0,
      percent: 0,
    })
  })

  it('counts a task assigned twice once, and as done when either row is done', () => {
    const duplicated = [
      ...checklist,
      // Same (task, speaker, submission) tuple. Airtable has no unique constraint, so a
      // row written directly in the base can look like this.
      item({ id: 'recAsgDupe', task: headshot, done: true }),
    ]
    const row = speakerProgress({ scopes: [owner], items: duplicated })[0]

    expect(row).toMatchObject({ assigned: 3, done: 1, label: '1/3' })
  })

  it('drops an assignment whose speaker is not on the roster', () => {
    const orphan = [...checklist, item({ id: 'recAsgGhost', task: travel, speakerId: STRANGER })]
    const rows = speakerProgress({ scopes: [owner], items: orphan })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.assigned).toBe(3)
  })

  it('counts a submission task once per submission for a speaker with three accepted', () => {
    const three: SpeakerScope = { ...owner, submissionIds: ['recSub1', 'recSub2', 'recSub3'] }
    const rows = speakerProgress({
      scopes: [three],
      items: [
        item({ id: 'recAsgA', task: slides, submissionId: 'recSub1', done: true }),
        item({ id: 'recAsgB', task: slides, submissionId: 'recSub2' }),
        item({ id: 'recAsgC', task: slides, submissionId: 'recSub3' }),
      ],
    })

    expect(rows[0]).toMatchObject({ label: '1/3', outstanding: 2 })
    // One title, listed once, even though two rows carry it.
    expect(rows[0]?.outstandingTitles).toEqual(['Upload your slides', 'Upload your slides'])
  })

  it('lists the outstanding titles alphabetically', () => {
    expect(speakerProgress({ scopes: [owner], items: checklist })[0]?.outstandingTitles).toEqual([
      'Confirm your travel',
      'Upload a headshot',
      'Upload your slides',
    ])
  })

  it('keeps one row per scope, in scope order', () => {
    const rows = speakerProgress({ scopes: [owner, co], items: checklist })

    expect(rows.map((row) => row.name)).toEqual(['Ada Okafor', 'Bo Lin'])
  })
})

describe('withOutstanding', () => {
  it('keeps only speakers who still owe something', () => {
    const rows = speakerProgress({
      scopes: [owner, co],
      items: [item({ id: 'recAsg1', task: headshot })],
    })

    // `co` has nothing assigned, so it owes nothing and drops out too.
    expect(withOutstanding(rows).map((row) => row.name)).toEqual(['Ada Okafor'])
  })
})

describe('progressTotals', () => {
  it('sums the roster and counts only speakers with a finished checklist as complete', () => {
    const rows = speakerProgress({
      scopes: [owner, co],
      items: [
        item({ id: 'recAsg1', task: headshot, done: true }),
        item({ id: 'recAsg2', task: travel }),
      ],
    })

    expect(progressTotals(rows)).toEqual({ speakers: 2, assigned: 2, done: 1, complete: 0 })
  })

  it('does not count a speaker with an empty checklist as complete', () => {
    const rows = speakerProgress({ scopes: [co], items: [] })

    expect(progressTotals(rows)).toEqual({ speakers: 1, assigned: 0, done: 0, complete: 0 })
  })
})

describe('duplicate assignment rows, all found by Codex review', () => {
  // Airtable has no unique constraint, so two rows CAN describe one to-do: a concurrent
  // assign, or a row added by hand. The bug was never the duplicates, it was that the three
  // surfaces reading them each deduplicated differently, so the admin dashboard could report
  // a speaker Complete while their own portal still listed the pending twin.

  it('counts one to-do, not two, when a tuple has two rows', () => {
    const rows = speakerProgress({
      scopes: [owner],
      items: [item({ id: 'a1', task: headshot }), item({ id: 'a2', task: headshot })],
    })

    expect(rows.at(0)?.label).toBe('0/1')
  })

  it('treats the to-do as done when either row is done, whichever order they arrive in', () => {
    // Done wins because the speaker did the thing, and chasing them for delivered work is
    // the worse failure on a surface whose whole purpose is deciding who to chase.
    const forward = speakerProgress({
      scopes: [owner],
      items: [item({ id: 'a1', task: headshot, done: true }), item({ id: 'a2', task: headshot })],
    })
    const reverse = speakerProgress({
      scopes: [owner],
      items: [item({ id: 'a1', task: headshot }), item({ id: 'a2', task: headshot, done: true })],
    })

    expect(forward.at(0)?.label).toBe('1/1')
    expect(reverse.at(0)?.label).toBe('1/1')
  })

  it('keeps a submission-scoped duplicate separate per submission', () => {
    // The tuple includes the submission, so the same task on two accepted submissions is two
    // real to-dos and must not collapse into one.
    const rows = speakerProgress({
      scopes: [{ ...owner, submissionIds: ['recSub1', 'recSub2'] }],
      items: [
        item({ id: 'a1', task: slides, submissionId: 'recSub1' }),
        item({ id: 'a2', task: slides, submissionId: 'recSub1' }),
        item({ id: 'a3', task: slides, submissionId: 'recSub2' }),
      ],
    })

    expect(rows.at(0)?.label).toBe('0/2')
  })
})

describe('mapTaskAssignmentIfIntact', () => {
  // The worst of the six, because the blast radius was every event. `loadTaskGraph` maps
  // every assignment in the base BEFORE filtering by event, and both links are required, so
  // one row whose task or speaker had been deleted (Airtable empties the link, it does not
  // remove the row) threw and took out every task dashboard and every portal task list.
  const intact = {
    id: 'recAsg1',
    fields: { task: ['recTask1'], speaker: ['recSpk1'], status: 'pending' },
  }

  it('maps a row whose links are both present', () => {
    expect(mapTaskAssignmentIfIntact(intact)?.taskId).toBe('recTask1')
  })

  it('skips a row whose task has been deleted instead of throwing', () => {
    expect(
      mapTaskAssignmentIfIntact({ ...intact, fields: { ...intact.fields, task: [] } }),
    ).toBeUndefined()
  })

  it('skips a row whose speaker has been deleted instead of throwing', () => {
    expect(
      mapTaskAssignmentIfIntact({ ...intact, fields: { ...intact.fields, speaker: [] } }),
    ).toBeUndefined()
  })

  it('still throws for a single record read, where the caller asked for THAT row', () => {
    // The strict mapper is kept and still used by `getTaskAssignment`: there, an empty
    // required link is a real fault about a record somebody named, not a row to skip past.
    expect(() => mapTaskAssignment({ ...intact, fields: { ...intact.fields, task: [] } })).toThrow()
  })
})
