// SPK-09 end to end, over the pure modules the chain is actually made of.
//
// This capability was scored `cannot_judge`, which costs exactly what a failure costs. The
// run's speaker had no accepted submission, so the only assignment path that existed could
// not reach them, their portal was empty, and nothing downstream could be exercised: no due
// date, no completion control, no persistence. Every individual piece was already tested and
// the CHAIN was not, which is how a product-level hole hid behind a green suite.
//
// So this file walks the whole thing in one go, on the persona that could not be reached:
// a speaker on the roster with nothing accepted.
//
//   1. Three general tasks are assigned to them BY NAME. Three rows, where the accepted-only
//      path produced none.
//   2. Those rows render in the portal with their due dates and an incomplete state.
//   3. Two are completed. Each produces the stored evidence its kind requires.
//   4. Re-derived from the stored rows, those two read done and the third still does not.
//
// WHAT STEP 4 DOES AND DOES NOT PROVE. `toTaskViews` reads `done` off the stored assignment
// status, so re-deriving from updated rows is a reload as far as any pure test can reach: no
// client state carries the tick. What it cannot prove is the cache expiry, which lives in
// `setTaskAssignmentStatus` (mutations-portal.ts `assignmentTags`) and expires
// `speaker:{id}:tasks` - the exact tag `listTaskAssignmentsForSpeaker` declares in
// reads-portal.ts. That pairing was verified by reading both, not by this file.

import { describe, expect, it } from 'vitest'

import type { PortalTaskItem } from '@/features/portal/ports'
import { buildCompletion } from '@/features/portal/task-completion'
import { groupTasks } from '@/features/portal/task-groups'
import { toTaskViews } from '@/features/portal/task-view'
import { planAssignments } from '@/features/tasks/plan'
import { chosenSpeakerScopes } from '@/features/tasks/roster-scope'
import { acceptedSpeakerScopes } from '@/features/tasks/scope'
import type { Task, TaskAssignment } from '@/types/domain'

import { CO_SPEAKER, OWNER, participant, speaker, submission, task } from './helpers/portal-fakes'

const EVENT_ZONE = 'America/New_York'

/** The persona the evaluation could not reach: on the roster, nothing accepted. */
const INVITED = speaker({
  id: CO_SPEAKER,
  firstName: 'Grace',
  lastName: 'Hopper',
  email: 'grace@example.com',
  status: 'confirmed',
})

const ROSTER = [speaker({ id: OWNER }), INVITED]

/** One accepted submission, and it belongs to somebody else. */
const SUBMISSIONS = [submission({ id: 'recSubA', status: 'accepted' }, [participant()])]

/** The three-task checklist, all contact-scoped, each with a deadline. */
const CHECKLIST: readonly Task[] = [
  task({
    id: 'recTaskBio',
    title: 'Confirm your biography',
    entityType: 'contact',
    kind: 'confirm',
    dueAt: '2026-09-01T23:59:00.000Z',
  }),
  task({
    id: 'recTaskHeadshot',
    title: 'Upload your headshot',
    entityType: 'contact',
    kind: 'upload',
    dueAt: '2026-09-08T23:59:00.000Z',
  }),
  task({
    id: 'recTaskCode',
    title: 'Read the code of conduct',
    entityType: 'contact',
    kind: 'link',
    description: 'Read it at https://example.test/conduct',
    dueAt: '2026-09-15T23:59:00.000Z',
  }),
]

function chosen() {
  return chosenSpeakerScopes({
    speakers: ROSTER,
    submissions: SUBMISSIONS,
    speakerIds: [INVITED.id],
  }).scopes
}

/** The rows the planner said to create, as the records a later read would return. */
function rowsFrom(plan: ReturnType<typeof planAssignments>): TaskAssignment[] {
  return plan.create.map((planned, index) => ({
    id: `recAsg${String(index + 1)}`,
    taskId: planned.taskId,
    speakerId: planned.speakerId,
    submissionId: planned.submissionId,
    status: 'pending' as const,
  }))
}

function portalItems(rows: readonly TaskAssignment[]): readonly PortalTaskItem[] {
  return rows.map((assignment) => {
    const found = CHECKLIST.find((entry) => entry.id === assignment.taskId)
    if (found === undefined) throw new Error(`no task ${assignment.taskId}`)
    return { assignment, task: found }
  })
}

function views(rows: readonly TaskAssignment[]) {
  return toTaskViews({
    items: portalItems(rows),
    submissions: SUBMISSIONS,
    forms: [],
    timeZone: EVENT_ZONE,
  })
}

describe('the accepted-only path is why this was unjudgeable', () => {
  it('reaches nobody when the chosen speaker has nothing accepted', () => {
    // Not a fixture accident. `acceptedSpeakerScopes` reads the cohort off accepted
    // submissions, so a speaker invited straight to the roster is not in it and no amount of
    // pressing "Assign to accepted speakers" will ever put a task on them.
    const scopes = acceptedSpeakerScopes(SUBMISSIONS)

    expect(scopes.map((scope) => scope.speaker.id)).not.toContain(INVITED.id)
  })
})

describe('SPK-09: assign, display, complete, persist', () => {
  it('assigns all three general tasks to a speaker chosen by name', () => {
    const plan = planAssignments({ tasks: CHECKLIST, scopes: chosen(), existing: [] })

    expect(plan.create).toHaveLength(3)
    expect(plan.create.map((row) => row.speakerId)).toEqual([INVITED.id, INVITED.id, INVITED.id])
    // Contact-scoped, so no submission link. This is what makes them reachable at all.
    expect(plan.create.every((row) => row.submissionId === undefined)).toBe(true)
  })

  it('shows all three in the portal, with due dates, none of them complete', () => {
    const rows = rowsFrom(planAssignments({ tasks: CHECKLIST, scopes: chosen(), existing: [] }))
    const rendered = views(rows)

    expect(rendered.map((view) => view.title)).toEqual([
      'Confirm your biography',
      'Upload your headshot',
      'Read the code of conduct',
    ])
    expect(rendered.map((view) => view.dueLabel)).toEqual([
      'Due Sep 1, 2026',
      'Due Sep 8, 2026',
      'Due Sep 15, 2026',
    ])
    expect(rendered.every((view) => !view.done)).toBe(true)
    // All three land in My Tasks rather than under a session, which is where a contact task
    // belongs and where the speaker persona would look for them.
    expect(groupTasks(portalItems(rows)).mine).toHaveLength(3)
  })

  it('completes two of them, storing the evidence each kind requires', () => {
    const confirmed = buildCompletion({
      task: CHECKLIST[0],
      submitted: { confirmed: true },
    })
    const uploaded = buildCompletion({
      task: CHECKLIST[1],
      submitted: { fileId: 'recFile1' },
    })

    expect(confirmed.answers).toEqual({ confirmed: true })
    expect(uploaded.answers).toEqual({ fileId: 'recFile1' })
  })

  it('reads the two as done and the untouched one as incomplete, on a fresh derivation', () => {
    const rows = rowsFrom(planAssignments({ tasks: CHECKLIST, scopes: chosen(), existing: [] }))
    // What the two completions stored. `done` is read off this, never off client state, so
    // deriving again is what a reload does.
    const afterCompleting = rows.map((row) =>
      row.taskId === 'recTaskCode'
        ? row
        : { ...row, status: 'done' as const, completedAt: '2026-08-20T10:00:00.000Z' },
    )

    const rendered = views(afterCompleting)

    expect(rendered.map((view) => [view.title, view.done])).toEqual([
      ['Confirm your biography', true],
      ['Upload your headshot', true],
      ['Read the code of conduct', false],
    ])
  })

  it('assigning the same checklist again writes nothing, so a second press is a no-op', () => {
    const first = planAssignments({ tasks: CHECKLIST, scopes: chosen(), existing: [] })
    const second = planAssignments({
      tasks: CHECKLIST,
      scopes: chosen(),
      existing: rowsFrom(first),
    })

    expect(second.create).toEqual([])
    expect(second.skipped).toBe(3)
  })

  it('a completed task is not re-created by a later assignment run', () => {
    // The row exists, so the tuple is skipped whatever its status. Re-assigning must never
    // reopen work a speaker has already done.
    const first = planAssignments({ tasks: CHECKLIST, scopes: chosen(), existing: [] })
    const done = rowsFrom(first).map((row) => ({ ...row, status: 'done' as const }))

    expect(planAssignments({ tasks: CHECKLIST, scopes: chosen(), existing: done }).create).toEqual(
      [],
    )
  })
})
