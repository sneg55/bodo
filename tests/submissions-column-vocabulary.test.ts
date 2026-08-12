// The three single-select submission columns: what a form's answer turns into on the
// way in, and what a person reads on the way out.
//
// Both halves come from the CFP-06 evaluation finding. The Abstracts list, the detail
// header and the reviewer queue read `talk` where the speaker had answered
// `Talk (30 min)`, because the column stored the form option's VALUE and every surface
// printed it verbatim. The column cannot store the label: `Submissions.format` is an
// Airtable single-select declared from `SESSION_FORMATS` (src/migrations/tables-core.ts)
// and an undeclared choice answers 422 for the whole record.

import { describe, expect, it } from 'vitest'

import { SESSION_FORMATS, SESSION_LANGUAGES, SESSION_LEVELS } from '@/constants/vocabularies'
import type { SubmissionColumn } from '@/features/forms/answer-storage'
import { submissionColumnValues } from '@/features/submissions/columns'
import {
  canonicalChoice,
  choiceLabel,
  sessionFormatLabel,
  sessionLanguageLabel,
  sessionLevelLabel,
} from '@/features/submissions/session-vocabulary'

function columns(entries: readonly [SubmissionColumn, unknown][]) {
  return submissionColumnValues(new Map(entries))
}

describe('canonicalChoice', () => {
  it('accepts the stored value unchanged', () => {
    expect(canonicalChoice(SESSION_FORMATS, 'talk')).toBe('talk')
  })

  it('accepts the human label, which is what OptionsEditor stores by default', () => {
    // "Adding an option fills the value from the label", so a Format question an
    // organizer typed by hand offers `value: 'Talk'` where the seed offers `'talk'`.
    // Both mean the one choice the column has, and only one of them used to survive.
    expect(canonicalChoice(SESSION_FORMATS, 'Talk')).toBe('talk')
    expect(canonicalChoice(SESSION_LEVELS, 'Intermediate')).toBe('intermediate')
  })

  it('ignores case and surrounding space on both sides of the match', () => {
    expect(canonicalChoice(SESSION_FORMATS, '  WORKSHOP ')).toBe('workshop')
    expect(canonicalChoice(SESSION_LANGUAGES, 'english')).toBe('English')
  })

  it('drops a value the vocabulary does not have rather than passing it to a 422', () => {
    // The whole record is rejected by Airtable, not just this field, so losing one
    // classification beats losing the abstract and every participant with it.
    expect(canonicalChoice(SESSION_FORMATS, 'Talk (30 min)')).toBeUndefined()
    expect(canonicalChoice(SESSION_FORMATS, '')).toBeUndefined()
    expect(canonicalChoice(SESSION_FORMATS, undefined)).toBeUndefined()
  })
})

describe('choiceLabel', () => {
  it('renders the label a person chose, not the machine key', () => {
    expect(sessionFormatLabel('lightning')).toBe('Lightning Talk')
    expect(sessionLevelLabel('advanced')).toBe('Advanced')
    expect(sessionLanguageLabel('Japanese')).toBe('Japanese')
  })

  it('passes an unknown value through rather than blanking it', () => {
    // An imported session or a base seeded before a vocabulary edit can hold one, and
    // showing it beats hiding it.
    expect(sessionFormatLabel('fireside')).toBe('fireside')
    expect(choiceLabel(SESSION_FORMATS, undefined)).toBeUndefined()
  })
})

describe('submissionColumnValues, the select columns', () => {
  it('canonicalizes format, level and language together', () => {
    expect(
      columns([
        ['format', 'Workshop'],
        ['level', 'BEGINNER'],
        ['language', 'spanish'],
      ]),
    ).toEqual({ format: 'workshop', level: 'beginner', language: 'Spanish' })
  })

  it('leaves the column empty when the answer names no declared choice', () => {
    expect(columns([['format', 'Talk (30 min)']]).format).toBeUndefined()
  })

  it('narrows the link and number columns without re-checking them', () => {
    // Only the three selects are vocabulary-bound HERE. Track and Tags carry record ids,
    // and `splitAnswers` has already resolved those against the question's own options
    // (tests/submissions-track-answer.test.ts), so this narrows a resolved list: one id
    // for the single link, the whole list for the multiple one.
    expect(
      columns([
        ['title', 'Agents that ship'],
        ['trackId', ['recTrack1']],
        ['tagIds', ['recTag1', 'recTag2']],
        ['ceuCredits', '1.5'],
      ]),
    ).toEqual({
      title: 'Agents that ship',
      trackId: 'recTrack1',
      tagIds: ['recTag1', 'recTag2'],
      ceuCredits: 1.5,
    })
  })

  it('leaves the track column empty when the answer resolved to nothing', () => {
    // The empty list is what `splitAnswers` produces for an answer that named no option,
    // and an empty column is the whole point: `resolveTrackId` can then fall through to a
    // routing rule instead of Airtable answering 422 for the entire submission.
    expect(columns([['trackId', []]]).trackId).toBeUndefined()
  })

  it('never joins a multi-valued track answer into one string', () => {
    // `asText` did, so a Track question the organizer made a multiselect wrote
    // "recTrack1 recTrack2" into a link column: one string naming no record.
    expect(columns([['trackId', ['recTrack1', 'recTrack2']]]).trackId).toBe('recTrack1')
  })
})
