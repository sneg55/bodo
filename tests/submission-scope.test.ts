import { describe, expect, it } from 'vitest'

import {
  filterScope,
  inScope,
  SUBMISSION_SCOPES,
  type SubmissionScope,
  scopeCopy,
} from '@/features/review/submission-scope'

const pending = { id: 'a', reviewRequired: true, status: 'pending' }
const accepted = { id: 'x', reviewRequired: true, status: 'accepted' }
const session = { id: 's', reviewRequired: false, status: 'pending' }
const rows = [pending, accepted, session]

describe('inScope', () => {
  it('keeps everything under `all`, which is what View All is', () => {
    expect(inScope(pending, 'all')).toBe(true)
    expect(inScope(session, 'all')).toBe(true)
  })

  it('puts every reviewed row on Abstracts, decided or not', () => {
    expect(inScope(pending, 'abstracts')).toBe(true)
    expect(inScope(accepted, 'abstracts')).toBe(true)
    expect(inScope(session, 'abstracts')).toBe(false)
  })

  it('puts the PROGRAM on Sessions: accepted abstracts, plus rows that skipped review', () => {
    // Splitting the two surfaces on `reviewRequired` alone left Sessions empty forever on
    // any event that runs a CFP, because every submission through a form is stamped with it.
    // An event with three accepted, scheduled, publicly listed talks reported "No sessions
    // found" while Abstracts and the Agenda both showed the same three.
    expect(inScope(session, 'sessions')).toBe(true)
    expect(inScope(accepted, 'sessions')).toBe(true)
    expect(inScope(pending, 'sessions')).toBe(false)
  })
})

describe('filterScope', () => {
  it('overlaps on an accepted abstract, which is on both surfaces on purpose', () => {
    const abstracts = filterScope(rows, 'abstracts')
    const sessions = filterScope(rows, 'sessions')

    expect(abstracts).toEqual([pending, accepted])
    expect(sessions).toEqual([accepted, session])
    // It is still an abstract that went through review, which is why the Abstracts tab
    // strip has an Accepted tab, and it is now also a session.
    expect(abstracts).toContain(accepted)
    expect(sessions).toContain(accepted)
    // Nothing is lost either way.
    expect(new Set([...abstracts, ...sessions]).size).toBe(filterScope(rows, 'all').length)
  })

  it('returns the input array itself under `all` rather than a copy', () => {
    expect(filterScope(rows, 'all')).toBe(rows)
  })
})

describe('scopeCopy', () => {
  it('gives every scope its own title, tab label and empty message', () => {
    const titles = SUBMISSION_SCOPES.map((scope) => scopeCopy(scope).title)
    expect(new Set(titles).size).toBe(SUBMISSION_SCOPES.length)

    const tabs = SUBMISSION_SCOPES.map((scope) => scopeCopy(scope).allTabLabel)
    expect(new Set(tabs).size).toBe(SUBMISSION_SCOPES.length)
  })

  it('keeps ref 19 verbatim on the Abstracts header', () => {
    expect(scopeCopy('abstracts')).toMatchObject({
      title: 'Abstracts',
      subtitle: 'Review and manage your abstract submissions',
      allTabLabel: 'All Abstracts',
    })
  })

  it('offers the Add drawer everywhere its label is true, and not on Sessions', () => {
    expect(scopeCopy('sessions').canAdd).toBe(false)
    expect(scopeCopy('abstracts').canAdd).toBe(true)
    expect(scopeCopy('all').canAdd).toBe(true)
  })

  it('falls back rather than throwing on a scope from outside the union', () => {
    expect(scopeCopy('nonsense' as SubmissionScope)).toBe(scopeCopy('abstracts'))
  })
})
