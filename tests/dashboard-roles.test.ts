// PARTICIPANTS BY ROLE, ref 36. Every test here is about the same trap: a participant row
// is not a person. `SubmissionParticipants` holds one row per (submission, speaker, role),
// so counting rows counts a speaker once per talk and once per role, and the panel's own
// description promises the opposite on both axes.

import { describe, expect, it } from 'vitest'

import type { ParticipantRole, SubmissionStatus } from '@/constants/status'
import { acceptedSpeakerCount, participantsByRole } from '@/features/dashboard/roles'

const cast = (...people: readonly [string, ParticipantRole][]) =>
  people.map(([speakerId, role]) => ({ speakerId, role }))

const submission = (
  participants: readonly { speakerId: string; role: ParticipantRole }[],
  status: SubmissionStatus = 'accepted',
) => ({ status, participants })

describe('participantsByRole', () => {
  it('counts a speaker on three talks once', () => {
    const view = participantsByRole([
      submission(cast(['spk1', 'speaker'])),
      submission(cast(['spk1', 'speaker'])),
      submission(cast(['spk1', 'speaker'])),
    ])

    expect(view.uniquePeople).toBe(1)
    expect(view.rows).toEqual([{ role: 'speaker', label: 'Speakers', count: 1, percent: 100 }])
  })

  it('counts a person in two roles once in the centre and once per role in the bar', () => {
    // The sentence in ref 36's description, made executable. Anyone who moderates one panel
    // and speaks on another is one unique participant and two segments of the bar, so the
    // rows deliberately sum to more than the centre total.
    const view = participantsByRole([
      submission(cast(['spk1', 'speaker'], ['spk2', 'co_speaker'])),
      submission(cast(['spk1', 'moderator'])),
    ])

    expect(view.uniquePeople).toBe(2)
    expect(view.total).toBe(3)
    expect(view.rows.map((row) => [row.label, row.count])).toEqual([
      ['Speakers', 1],
      ['Co-Speakers', 1],
      ['Moderators', 1],
    ])
  })

  it('takes percent over the bar so the legend agrees with the segments it labels', () => {
    const view = participantsByRole([
      submission(cast(['spk1', 'speaker'], ['spk2', 'speaker'], ['spk3', 'co_speaker'])),
      submission(cast(['spk1', 'moderator'])),
    ])

    expect(view.uniquePeople).toBe(3)
    expect(view.total).toBe(4)
    expect(view.rows.map((row) => row.percent)).toEqual([50, 25, 25])
    // Over the centre total instead, these would be 67/33/33 and sum to 133% beside a bar
    // that visibly summed to a whole.
    expect(view.rows.reduce((sum, row) => sum + row.percent, 0)).toBe(100)
  })

  it('keeps the roles in settings order rather than by size', () => {
    const view = participantsByRole([
      submission(cast(['spk1', 'chairperson'], ['spk2', 'chairperson'], ['spk3', 'speaker'])),
    ])

    expect(view.rows.map((row) => row.role)).toEqual(['speaker', 'chairperson'])
  })

  it('gives a role nobody holds no row at all', () => {
    const view = participantsByRole([submission(cast(['spk1', 'speaker']))])

    expect(view.rows).toHaveLength(1)
  })

  it('counts a pending cast but not a draft one', () => {
    // Ref 36 reports six participants on an event holding one accepted and three pending
    // submissions, so pending casts count. A draft is not a submission, which is the line
    // the tiles and the forms row already draw (tests/dashboard-home.test.ts).
    const view = participantsByRole([
      submission(cast(['spk1', 'speaker']), 'pending'),
      submission(cast(['spk2', 'speaker']), 'draft'),
    ])

    expect(view.uniquePeople).toBe(1)
    expect(view.rows.at(0)?.count).toBe(1)
  })

  it('reports nothing rather than dividing by zero on a quiet event', () => {
    const view = participantsByRole([])

    expect(view).toEqual({ uniquePeople: 0, total: 0, rows: [] })
  })
})

describe('acceptedSpeakerCount', () => {
  it('counts people and not accepted submissions', () => {
    // Ref 34's KPI tile. Two accepted talks by the same pair of people is two speakers.
    expect(
      acceptedSpeakerCount([
        submission(cast(['spk1', 'speaker'], ['spk2', 'co_speaker'])),
        submission(cast(['spk1', 'speaker'], ['spk2', 'co_speaker'])),
      ]),
    ).toBe(2)
  })

  it('ignores the cast of anything not accepted', () => {
    expect(
      acceptedSpeakerCount([
        submission(cast(['spk1', 'speaker']), 'pending'),
        submission(cast(['spk2', 'speaker']), 'declined'),
        submission(cast(['spk3', 'speaker'])),
      ]),
    ).toBe(1)
  })
})
