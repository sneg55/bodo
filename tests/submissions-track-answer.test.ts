// What a Track answer has to survive to reach the `track` LINK column, which is the
// CFP-15 evaluation finding: a speaker chose "Platform & Infra", every record-level
// surface read "Agents", and the accepted session and its agenda row silently mislabelled
// the talk.
//
// The precedence rule was fixed first and is NOT what these cover: `track-precedence.ts`
// already ranks an answered Track question above the seeded routing rule
// `format eq talk -> Agents`. What was left is one layer down. `columns.ts` cast the raw
// answer to a `RecordId` with nothing checking that it named a track at all, so the answer
// either arrived as something Airtable rejects for the whole record, or never became a
// usable id and precedence correctly fell through to the routing rule.
//
// So the chain under test is the real one, in the order `prepareSubmission` runs it:
// `splitAnswers` resolves the answer against the question's own options, then
// `submissionColumnValues` narrows it, then `resolveTrackId` ranks it against routing.
// Testing the three separately is how they came to disagree in the first place.

import { describe, expect, it } from 'vitest'

import { splitAnswers } from '@/features/forms/answer-storage'
import type { FormAnswers } from '@/features/forms/logic'
import { submissionColumnValues } from '@/features/submissions/columns'
import { linkedOptionValues } from '@/features/submissions/session-vocabulary'
import { resolveTrackId, staleTrackId } from '@/features/submissions/track-precedence'
import type { FormField, RoutingConfig } from '@/types/forms'

/** The event's real tracks, as `loadFormEditor` turns them into option rows. */
const INFRA = 'recPlatformInfra'
const AGENTS = 'recAgentsTrack'
const PRODUCT = 'recProductTrack'

const EVENT_TRACK_OPTIONS = [
  { value: INFRA, label: 'Platform & Infra' },
  { value: AGENTS, label: 'Agents' },
]

const FORMAT: FormField = {
  id: 'fld_format',
  type: 'select',
  label: 'Format',
  required: true,
  registryKey: 'format',
  options: [
    { value: 'talk', label: 'Talk (30 min)' },
    { value: 'workshop', label: 'Workshop (90 min)' },
  ],
}

/** A Track question bound to the library, with this event's own categories on it. */
const TRACK: FormField = {
  id: 'fld_track',
  type: 'select',
  label: 'Track',
  required: false,
  registryKey: 'track',
  options: EVENT_TRACK_OPTIONS,
}

/** The seeded CFP form's routing, which is what beat the speaker's answer. */
const ROUTING: RoutingConfig = {
  rules: [{ when: { fieldId: 'fld_format', op: 'eq', value: 'talk' }, trackId: AGENTS }],
  defaultTrackId: PRODUCT,
}

/**
 * The whole submit-side chain, so a test cannot pass by exercising one link of it.
 * `prepareSubmission` and `prepareDraft` compose exactly these three calls.
 */
function trackIdFor(fields: readonly FormField[], answers: FormAnswers): string | undefined {
  const split = splitAnswers(fields, answers)
  const columns = submissionColumnValues(split.columns)
  return resolveTrackId({ routing: ROUTING, fields, answers, columns })
}

describe('linkedOptionValues, the resolution rule', () => {
  it('accepts an answer that already holds the record id', () => {
    expect(linkedOptionValues(EVENT_TRACK_OPTIONS, [INFRA])).toEqual([INFRA])
  })

  it('accepts the option LABEL and returns the record id behind it', () => {
    // A Track question an organizer bound by hand can carry the track's NAME where the
    // library-bound one carries its id. Both mean the same record.
    expect(linkedOptionValues(EVENT_TRACK_OPTIONS, ['Platform & Infra'])).toEqual([INFRA])
  })

  it('ignores case and surrounding space when matching a label', () => {
    expect(linkedOptionValues(EVENT_TRACK_OPTIONS, ['  platform & INFRA '])).toEqual([INFRA])
  })

  it('drops a value that matches no option rather than passing it to a link column', () => {
    // The alternative is Airtable answering 422 for the whole record, which loses the
    // abstract and every participant on it.
    expect(linkedOptionValues(EVENT_TRACK_OPTIONS, ['Frontend'])).toEqual([])
  })

  it('drops everything when the question offers no options at all', () => {
    // Nothing vouches for the value, so nothing is stored. This is the Track question a
    // library add creates before the organizer picks its categories.
    expect(linkedOptionValues(undefined, [INFRA])).toEqual([])
    expect(linkedOptionValues([], [INFRA])).toEqual([])
  })

  it('keeps every distinct match, in answer order, for a multi-value question', () => {
    expect(linkedOptionValues(EVENT_TRACK_OPTIONS, ['Agents', INFRA, AGENTS])).toEqual([
      AGENTS,
      INFRA,
    ])
  })
})

describe('the Track answer against the routing rule that used to beat it', () => {
  it('files the submission under the track the speaker chose, by record id', () => {
    // The CFP-15 criterion. Format is "Talk (30 min)", so the seeded rule
    // `format eq talk -> Agents` fires and must still lose.
    expect(trackIdFor([FORMAT, TRACK], { fld_format: 'talk', fld_track: INFRA })).toBe(INFRA)
  })

  it('files it under the same track when the answer holds the label', () => {
    expect(trackIdFor([FORMAT, TRACK], { fld_format: 'talk', fld_track: 'Platform & Infra' })).toBe(
      INFRA,
    )
  })

  it('falls through to the routing rule when the answer names no track on this event', () => {
    // Not a regression: an unresolvable answer is no answer, and a rule deciding is better
    // than a 422 that rejects the abstract. What must not happen is a value that is not a
    // record id reaching the link column.
    expect(trackIdFor([FORMAT, TRACK], { fld_format: 'talk', fld_track: 'Frontend' })).toBe(AGENTS)
  })

  it('falls through to the routing rule when the Track question was left blank', () => {
    expect(trackIdFor([FORMAT, TRACK], { fld_format: 'talk' })).toBe(AGENTS)
  })

  it('falls through to the default when the form asks no Track question and no rule fires', () => {
    // R1's acceptance criterion: routing still decides every submission through a form
    // that does not ask, which is what the seeded CFP form is.
    expect(trackIdFor([FORMAT], { fld_format: 'workshop' })).toBe(PRODUCT)
  })

  it('never writes a value that is not one of the event categories into the column', () => {
    // The mechanism, stated directly. `columns.trackId` used to be whatever string the
    // answer carried, so "Platform & Infra" reached an Airtable link field as a record id.
    const split = splitAnswers([TRACK], { fld_track: 'Platform & Infra' })
    expect(submissionColumnValues(split.columns).trackId).toBe(INFRA)

    const bogus = splitAnswers([TRACK], { fld_track: 'Frontend' })
    expect(submissionColumnValues(bogus.columns).trackId).toBeUndefined()
  })

  it('does not join a multiselect Track answer into one string that names no record', () => {
    const multi: FormField = { ...TRACK, type: 'multiselect' }
    const split = splitAnswers([multi], { fld_track: [INFRA, AGENTS] })

    expect(submissionColumnValues(split.columns).trackId).toBe(INFRA)
  })
})

describe('staleTrackId, repairing a record the precedence fix landed too late for', () => {
  /**
   * `resolveTrackId({ routing: ROUTING, fields: [FORMAT, TRACK], answers, columns })` for
   * the given answers, plus the stored value to check it against. Mirrors `trackIdFor`
   * above but keeps `columns` around, since `staleTrackId` needs it separately.
   */
  function reconcile(answers: FormAnswers, storedTrackId: string | undefined): string | undefined {
    const split = splitAnswers([FORMAT, TRACK], answers)
    const columns = submissionColumnValues(split.columns)
    return staleTrackId({
      routing: ROUTING,
      fields: [FORMAT, TRACK],
      answers,
      columns,
      storedTrackId,
    })
  }

  it('corrects a record the old precedence filed under the routing rule instead of the answer', () => {
    // Exactly the CFP-15 shape: a Talk answered with Track "Platform & Infra", written under
    // "Agents" by `matchedTrackId(...) ?? columns.trackId`.
    expect(reconcile({ fld_format: 'talk', fld_track: INFRA }, AGENTS)).toBe(INFRA)
  })

  it('does nothing once the stored value already agrees with the answer', () => {
    expect(reconcile({ fld_format: 'talk', fld_track: INFRA }, INFRA)).toBeUndefined()
  })

  it('never touches a record with no answered Track question, however it disagrees with routing', () => {
    // No `fld_track` answer at all: `columns.trackId` is `undefined`, so this is case 2 or 3,
    // both of which are an organizer's decision this function cannot distinguish from
    // staleness. A record stored under PRODUCT here might be a deliberate reassignment, or a
    // routing rule as it stood before an organizer edited it. Left alone either way.
    expect(reconcile({ fld_format: 'talk' }, PRODUCT)).toBeUndefined()
    expect(reconcile({ fld_format: 'talk' }, undefined)).toBeUndefined()
  })

  it('never touches a record whose Track answer no longer names one of this event’s categories', () => {
    // `columns.trackId` resolves to `undefined` when the answer names nothing (a track since
    // renamed or deleted), so this is indistinguishable from "never asked" and is left alone
    // rather than guessed at.
    expect(reconcile({ fld_format: 'talk', fld_track: 'Frontend' }, AGENTS)).toBeUndefined()
  })
})
