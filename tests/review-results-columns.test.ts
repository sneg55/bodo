// The header row of the review results report, and the two columns that were wrong in the
// downloaded file.
//
// Read off an actual export of the seeded event on 2026-08-10:
//
//   Code,Title,Status,Review status,Reviewers,Reviews,Score,Recommendation,Originality,
//   Recommendation,Comments
//   SESS-22,Taming 40-Minute CI...,pending,Not started,"<tab>-",0,...
//
// Three things at once: `Recommendation` twice with two different meanings, an empty
// `Reviewers` cell on a row the same file marks `Not started` (SESS-22 is assigned to
// sam.whitfield in that round), and every blank cell written as a quoted tab-dash.
//
// Split from review-results.test.ts, which asserts what a ROW says, and sharing its fixtures
// so both describe the same round.

import { describe, expect, it } from 'vitest'

import { resultsHeaders, reviewResultsTable } from '@/features/review/review-results'

import { CRITERIA, input, ORIGINALITY, RECOMMENDATION } from './helpers/review-results-fixtures'

describe('the header row', () => {
  it('names the fixed columns, then one column per criterion in the round order', () => {
    expect(resultsHeaders(CRITERIA)).toEqual([
      'Code',
      'Title',
      'Status',
      'Review status',
      // Two columns, because who was ASKED and who ANSWERED are different questions and the
      // row's own `Review status` distinguishes them.
      'Assigned reviewers',
      'Reviewers who filed',
      'Reviews',
      'Score',
      // The round's own verdict, named so it cannot be read as the criterion two columns
      // along, which is what let that criterion keep its own plain label.
      'Round recommendation',
      'Originality',
      'Recommendation',
      'Comments',
    ])
  })

  it('never emits two columns with the same name, whatever a rubric is called', () => {
    // Criterion labels are organizer-authored, so any of them can collide with a fixed
    // header or with each other. Two identically named columns is not an error anywhere: the
    // file opens and every reader downstream guesses which is which.
    const collides = [
      { ...ORIGINALITY, key: 'score', label: 'Score' },
      RECOMMENDATION,
      { ...RECOMMENDATION, key: 'rec2' },
    ]
    const headers = resultsHeaders(collides)

    expect(new Set(headers).size).toBe(headers.length)
    // Against a fixed header, and against another criterion with the same label.
    expect(headers).toContain('Score (criterion)')
    expect(headers).toContain('Recommendation (criterion)')
  })

  it('is the row the table actually emits', () => {
    // Asserted through the grid as well as through the function, so the two cannot drift:
    // the header is the only row in the file with no submission behind it.
    expect(reviewResultsTable(input()).at(0)).toEqual(resultsHeaders(CRITERIA))
  })
})

describe('an absent value', () => {
  it('is an empty field rather than a dash', () => {
    // Not cosmetic. `csvCell` prefixes a tab to any value a spreadsheet would evaluate as a
    // formula, and a lone `-` is one, so the table's on-screen placeholder came out of the
    // export as a quoted tab-dash in every blank cell of every row.
    const [, row] = reviewResultsTable(input())

    expect(row.filter((value) => value === '-')).toEqual([])
    // Assigned reviewers, reviewers who filed, score, round recommendation, three criteria.
    expect(row.filter((value) => value === '')).toHaveLength(7)
  })
})
