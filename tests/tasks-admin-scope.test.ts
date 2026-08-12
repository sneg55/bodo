// WHO the admin Tasks page's "Onboarding status" table is allowed to contain.
//
// The half `speakerProgress` cannot get wrong on its own: it renders whatever scopes it is
// handed (tests/tasks-progress.test.ts covers the arithmetic), so a person missing from the
// table is a person missing from `rosterScopes`. The table used to be built from
// `acceptedSpeakerScopes` alone, and an eval run assigned three tasks by hand to a speaker
// with nothing accepted and then could not find them in it at all.
//
// The rules worth pinning are that the roster is the scope, that the accepted submissions
// each person carries are still the ones the bulk Assign path would have used, and that
// widening the table did not drop the one kind of person it already had.

import { describe, expect, it } from 'vitest'

import { rosterScopes } from '@/features/tasks/admin-view'
import { speakerProgress } from '@/features/tasks/progress'
import { acceptedSpeakerScopes } from '@/features/tasks/scope'
import type { TaskAssignmentItem } from '@/services/airtable/reads-portal'

import {
  assignment,
  CO_SPEAKER,
  OWNER,
  participant,
  STRANGER,
  speaker,
  submission,
  task,
} from './helpers/portal-fakes'

const ADA = speaker({ id: OWNER, firstName: 'Ada', lastName: 'Okafor' })
const BO = speaker({ id: CO_SPEAKER, firstName: 'Bo', lastName: 'Lin', email: 'bo@example.com' })

const headshot = task({ id: 'recTaskHeadshot', entityType: 'contact', title: 'Upload a headshot' })
const travel = task({ id: 'recTaskTravel', entityType: 'contact', title: 'Confirm your travel' })
const slides = task({ id: 'recTaskSlides', entityType: 'submission', title: 'Upload your slides' })

const ADA_ACCEPTED = [
  submission({ id: 'recSubA', status: 'accepted' }, [participant({ speakerId: OWNER })]),
]

/** `rosterScopes` with the `accepted` argument the caller derives from the same submissions. */
function scopesFor(input: {
  speakers: readonly ReturnType<typeof speaker>[]
  submissions: typeof ADA_ACCEPTED
}): ReturnType<typeof rosterScopes> {
  return rosterScopes({
    speakers: input.speakers,
    submissions: input.submissions,
    accepted: acceptedSpeakerScopes(input.submissions),
  })
}

function item(overrides: {
  id: string
  task: typeof headshot
  speakerId: string
  submissionId?: string
}): TaskAssignmentItem {
  return {
    task: overrides.task,
    assignment: assignment({
      id: overrides.id,
      taskId: overrides.task.id,
      speakerId: overrides.speakerId,
      submissionId: overrides.submissionId,
      status: 'pending',
    }),
  }
}

describe('rosterScopes', () => {
  it('includes a roster speaker with nothing accepted', () => {
    // Bo is on the event and has no accepted session: exactly the person the by-hand Assign
    // path exists for, and exactly the person the accepted-only scope dropped.
    const scopes = scopesFor({ speakers: [ADA, BO], submissions: ADA_ACCEPTED })

    expect(scopes.map((scope) => scope.speaker.id)).toEqual([OWNER, CO_SPEAKER])
    // With nothing accepted, a submission-scoped task has nowhere to land. The empty list is
    // what records that rather than hides it.
    expect(scopes.at(1)?.submissionIds).toEqual([])
  })

  it('carries the accepted submissions the bulk path would have used, and only those', () => {
    const scopes = scopesFor({
      speakers: [ADA],
      submissions: [
        ...ADA_ACCEPTED,
        submission({ id: 'recSubB', status: 'accepted' }, [
          participant({ speakerId: OWNER, submissionId: 'recSubB' }),
        ]),
        // Pending, so it must not appear even though Ada is on it.
        submission({ id: 'recSubC', status: 'pending' }, [
          participant({ speakerId: OWNER, submissionId: 'recSubC' }),
        ]),
      ],
    })

    expect(scopes.at(0)?.submissionIds).toEqual(['recSubA', 'recSubB'])
  })

  it('keeps an accepted speaker whose record is not linked to the event', () => {
    // `listSpeakers` filters on the `events` link on the Speakers row, so a co-presenter
    // created without it is accepted and absent from the roster read. Widening the table must
    // not lose the one kind of person it already had.
    const scopes = scopesFor({
      speakers: [ADA],
      submissions: [
        submission({ id: 'recSubZ', status: 'accepted' }, [
          participant({
            speakerId: STRANGER,
            submissionId: 'recSubZ',
            speaker: speaker({ id: STRANGER, firstName: 'Zoë', lastName: 'Zed' }),
          }),
        ]),
      ],
    })

    expect(scopes.map((scope) => scope.speaker.id)).toEqual([OWNER, STRANGER])
  })

  it('yields one scope per person who is both on the roster and accepted', () => {
    const scopes = scopesFor({ speakers: [ADA], submissions: ADA_ACCEPTED })

    expect(scopes).toHaveLength(1)
    expect(scopes.at(0)?.submissionIds).toEqual(['recSubA'])
  })

  it('produces a progress row for a speaker assigned tasks by hand', () => {
    // The end-to-end shape of the defect: three tasks assigned to Bo, who has nothing
    // accepted, now read 0/3 instead of Bo not being in the table at all.
    const rows = speakerProgress({
      scopes: scopesFor({ speakers: [ADA, BO], submissions: ADA_ACCEPTED }),
      items: [
        item({ id: 'recAsgB1', task: headshot, speakerId: CO_SPEAKER }),
        item({ id: 'recAsgB2', task: travel, speakerId: CO_SPEAKER }),
        item({ id: 'recAsgB3', task: slides, speakerId: CO_SPEAKER, submissionId: 'recSubA' }),
      ],
    })

    expect(rows.map((row) => row.name)).toEqual(['Ada Okafor', 'Bo Lin'])
    expect(rows.at(1)).toMatchObject({ label: '0/3', outstanding: 3 })
  })
})
