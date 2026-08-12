// What a valid submit turns into: the lifecycle it lands in, where each answer is
// stored, and which track it is filed under. The refusals and the reported problems
// are in submissions-prepare-problems.test.ts.

import { describe, expect, it } from 'vitest'

import { prepareSubmission } from '@/features/submissions/prepare'
import type { Form } from '@/types/forms'

import {
  CFP_FORM,
  cfpPayload,
  expectPrepared,
  NOW,
  prepareCfp,
  soloSpeaker,
} from './helpers/cfp-form'

/**
 * The CFP form with a Track question added, which is the shape the whole precedence
 * question turns on: routing decides a form that does not ask, the speaker decides one
 * that does. Routing defaults to the shipped rules so a caller opting out has to say so.
 *
 * It carries OPTIONS, and it has to: `track` writes an Airtable link, so `splitAnswers`
 * resolves the answer against the question's own option list rather than casting it, and a
 * question offering nothing can vouch for no answer. See tests/submissions-track-answer.
 */
function formAskingForTrack(routing: Form['routing'] = CFP_FORM.routing): Form {
  return {
    ...CFP_FORM,
    fields: [
      ...CFP_FORM.fields,
      {
        id: 'f_track',
        type: 'select',
        label: 'Track',
        required: false,
        registryKey: 'track',
        options: [{ value: 'trkChosen', label: 'Platform & Infra' }],
      },
    ],
    routing,
  }
}

describe('prepareSubmission, the happy path', () => {
  it('accepts a solo speaker under the shipped defaults', () => {
    const prepared = expectPrepared(prepareCfp())
    expect(prepared.participants).toHaveLength(1)
    expect(prepared.participants[0].isPrimary).toBe(true)
    expect(prepared.participants[0].role).toBe('speaker')
    expect(prepared.participants[0].sortOrder).toBe(1)
  })

  it('splits registry answers into columns and leaves local ones in answersJson', () => {
    const prepared = expectPrepared(prepareCfp())
    expect(prepared.title).toBe('Agents that ship')
    expect(prepared.columns.format).toBe('talk')
    // The local question keeps its field id and stays out of the typed columns.
    expect(prepared.answers).toEqual({ f_notes: 'Prefer the morning' })
  })

  it('titles a submission from a form with no Title field rather than failing', () => {
    const untitled: Form = {
      ...CFP_FORM,
      fields: CFP_FORM.fields.filter((field) => field.id !== 'f_title'),
    }
    const prepared = expectPrepared(prepareCfp(untitled, { answers: { f_format: 'talk' } }))
    expect(prepared.title).toBe('Untitled submission')
  })

  it('routes on the first matching rule, and to the default when none match', () => {
    expect(expectPrepared(prepareCfp()).trackId).toBe('trkTalk')

    const workshop = prepareCfp(CFP_FORM, {
      answers: { f_title: 'Build an eval', f_format: 'workshop', f_lab: 'Two laptops' },
    })
    expect(expectPrepared(workshop).trackId).toBe('trkWorkshop')

    const noRules = prepareCfp({
      ...CFP_FORM,
      routing: { rules: [], defaultTrackId: 'trkDefault' },
    })
    expect(expectPrepared(noRules).trackId).toBe('trkDefault')
  })

  it('lets a speaker-answered Track win when no routing rule matched', () => {
    // The precedence bug, pinned. `routeToTrack` used to return the form's default
    // rather than undefined when nothing matched, so this branch was unreachable and
    // every submission filed under the default track no matter what the speaker chose.
    const prepared = expectPrepared(
      prepareCfp(formAskingForTrack({ rules: [], defaultTrackId: 'trkDefault' }), {
        answers: { f_title: 'Agents that ship', f_format: 'talk', f_track: 'trkChosen' },
      }),
    )

    expect(prepared.trackId).toBe('trkChosen')
  })

  it('prefers the speaker-answered Track over a matching rule', () => {
    // CFP-06 and CFP-15. The seeded form carries `format eq talk -> Agents`, so a
    // speaker who chose a different track was silently overruled by it: the Abstracts
    // list, the reviewer queue and the agenda showed a track they never picked while
    // their own submitted answers showed the one they did.
    const prepared = expectPrepared(
      prepareCfp(formAskingForTrack(), {
        answers: { f_title: 'Agents that ship', f_format: 'talk', f_track: 'trkChosen' },
      }),
    )

    expect(prepared.trackId).toBe('trkChosen')
  })

  it('falls back to the rule when the Track question is on the form but unanswered', () => {
    // Track is seeded optional (an event with no tracks yet cannot offer any), so the
    // question being present must not disarm routing. Only an ANSWER outranks a rule.
    const prepared = expectPrepared(
      prepareCfp(formAskingForTrack(), {
        answers: { f_title: 'Agents that ship', f_format: 'talk', f_track: '' },
      }),
    )

    expect(prepared.trackId).toBe('trkTalk')
  })

  it('strips an answer to a question the speaker was not shown', () => {
    // f_lab is only visible for a workshop, so a payload carrying it alongside `talk`
    // is the stale-conditional case sanitizeAnswers exists for.
    const prepared = expectPrepared(
      prepareCfp(CFP_FORM, {
        answers: { f_title: 'Agents that ship', f_format: 'talk', f_lab: 'left over' },
      }),
    )
    expect(prepared.answers.f_lab).toBeUndefined()
  })

  it('ignores an answer that names no field of this form', () => {
    const prepared = expectPrepared(
      prepareCfp(CFP_FORM, {
        answers: { f_title: 'Agents that ship', f_format: 'talk', f_smuggled: 'nope' },
      }),
    )
    expect(prepared.answers.f_smuggled).toBeUndefined()
  })

  it('routes off the sanitized answers, not a hidden one', () => {
    // A payload claiming `talk` while still carrying the workshop-only answer must not
    // be filed under the workshop track.
    const prepared = expectPrepared(
      prepareCfp(CFP_FORM, {
        answers: { f_title: 'T', f_format: 'talk', f_lab: 'left over' },
      }),
    )
    expect(prepared.trackId).toBe('trkTalk')
  })

  it('writes the biography through to the Speakers row from its field type', () => {
    const prepared = expectPrepared(
      prepareCfp(CFP_FORM, {
        participants: [
          soloSpeaker({
            email: 'ADA@Example.com ',
            answers: { p_bio: 'Builds evaluation harnesses.' },
          }),
        ],
      }),
    )
    const draft = prepared.participants[0].draft
    // Normalised, because an address typed with different capitalisation is the same
    // account and a second Speakers row is a support ticket nobody can fix.
    expect(draft.email).toBe('ada@example.com')
    expect(draft.bio).toBe('Builds evaluation harnesses.')
    expect(draft.eventIds).toEqual(['ev1'])
  })

  it('gives one person one Speakers row and two participant rows', () => {
    const prepared = expectPrepared(
      prepareCfp(CFP_FORM, {
        participants: [
          soloSpeaker(),
          soloSpeaker({ key: 'p2', role: 'co_speaker', isPrimary: false }),
        ],
      }),
    )
    expect(prepared.participants.map((participant) => participant.draft.email)).toEqual([
      'ada@example.com',
      'ada@example.com',
    ])
    expect(prepared.participants.map((participant) => participant.sortOrder)).toEqual([1, 2])
  })
})

describe('prepareSubmission, the two intake kinds', () => {
  // BUILD_SPEC section 5.1b: the difference is whether the content goes through review
  // at all, and `reviewRequired` is stamped here rather than read from the form later.
  it('stamps an abstract pending with reviewRequired', () => {
    const prepared = expectPrepared(prepareCfp())
    expect(prepared.status).toBe('pending')
    expect(prepared.reviewRequired).toBe(true)
    expect(prepared.createsReviewRows).toBe(true)
  })

  it('stamps a session accepted, with no review and no review rows', () => {
    const prepared = expectPrepared(prepareCfp({ ...CFP_FORM, entityKind: 'sessions' }))
    expect(prepared.status).toBe('accepted')
    expect(prepared.reviewRequired).toBe(false)
    expect(prepared.createsReviewRows).toBe(false)
  })
})

describe('prepareSubmission with participants turned off', () => {
  const soloForm: Form = { ...CFP_FORM, participantsEnabled: false }

  it('files the submitter as the sole primary speaker', () => {
    const prepared = expectPrepared(
      prepareSubmission({
        form: soloForm,
        eventId: 'ev1',
        payload: { ...cfpPayload(), participants: [] },
        now: NOW,
        existingCount: 0,
        limit: 3,
      }),
    )
    expect(prepared.participants).toHaveLength(1)
    expect(prepared.participants[0].draft.email).toBe('ada@example.com')
    expect(prepared.participants[0].isPrimary).toBe(true)
    expect(prepared.participants[0].role).toBe('speaker')
  })

  it('ignores participants sent anyway, rather than validating them', () => {
    const prepared = expectPrepared(
      prepareSubmission({
        form: soloForm,
        eventId: 'ev1',
        payload: cfpPayload({
          participants: [
            soloSpeaker({ key: 'p9', role: 'moderator', isPrimary: false, email: '' }),
          ],
        }),
        now: NOW,
        existingCount: 0,
        limit: 3,
      }),
    )
    expect(prepared.participants).toHaveLength(1)
  })
})
