// `matchesFilters` on its own: contact types, rule composition, and the session fields.
//
// Split out of tests/portal-match.test.ts when that file passed the size limit. The seam
// is the natural one: this file asks whether ONE contact satisfies ONE filter set, which
// is a question with no portals in it at all, while the other file asks which portal out
// of an ordered list a contact lands in.

import { describe, expect, it } from 'vitest'

import { matchesFilters } from '@/features/portal-config/match'
import type { PortalContact, PortalContactSession, PortalFilters } from '@/types/portals'

function session(
  over: Partial<PortalContactSession> & { submissionId: string },
): PortalContactSession {
  return { tagIds: [], ...over }
}

function contact(over: Partial<PortalContact> & { speakerId: string }): PortalContact {
  return { roles: ['speaker'], sessions: [], ...over }
}

function filters(over: Partial<PortalFilters>): PortalFilters {
  return { contactTypes: [], rules: [], ...over }
}

describe('matchesFilters: contact types', () => {
  it('matches every type when the list is empty', () => {
    expect(matchesFilters(filters({}), contact({ speakerId: 'sp1', roles: [] }))).toBe(true)
  })

  it('matches a contact holding any one of the wanted types', () => {
    const wanted = filters({ contactTypes: ['moderator', 'chairperson'] })
    const both = contact({ speakerId: 'sp1', roles: ['speaker', 'moderator'] })

    expect(matchesFilters(wanted, both)).toBe(true)
    expect(matchesFilters(wanted, contact({ speakerId: 'sp2', roles: ['speaker'] }))).toBe(false)
  })

  it('treats submitter as a targetable type of its own', () => {
    const submitters = filters({ contactTypes: ['submitter'] })

    expect(matchesFilters(submitters, contact({ speakerId: 'sp1', roles: ['submitter'] }))).toBe(
      true,
    )
    expect(matchesFilters(submitters, contact({ speakerId: 'sp2', roles: ['speaker'] }))).toBe(
      false,
    )
  })
})

describe('matchesFilters: rules', () => {
  const acme = contact({ speakerId: 'sp1', company: 'Acme' })

  it('ANDs rules and ORs the values within one rule', () => {
    const rule = filters({
      rules: [
        { field: 'company', operator: 'is', values: ['Acme', 'Globex'] },
        { field: 'role', operator: 'is', values: ['speaker'] },
      ],
    })

    expect(matchesFilters(rule, acme)).toBe(true)
    expect(matchesFilters(rule, contact({ speakerId: 'sp2', company: 'Globex' }))).toBe(true)
    // Second rule fails, so the pair fails.
    expect(
      matchesFilters(rule, contact({ speakerId: 'sp3', company: 'Acme', roles: ['moderator'] })),
    ).toBe(false)
  })

  it('compares text values case- and whitespace-insensitively', () => {
    const rule = filters({ rules: [{ field: 'company', operator: 'is', values: [' acme '] }] })

    expect(matchesFilters(rule, acme)).toBe(true)
  })

  it('matches nothing when values is empty, for is', () => {
    const rule = filters({ rules: [{ field: 'company', operator: 'is', values: [] }] })

    expect(matchesFilters(rule, acme)).toBe(false)
  })

  it('matches nothing when values is empty, for is_not too', () => {
    // The half-built exclusion rule. Negating an empty set would publish the portal to
    // the whole conference; excluding drops everyone to the default instead.
    const rule = filters({ rules: [{ field: 'company', operator: 'is_not', values: [] }] })

    expect(matchesFilters(rule, acme)).toBe(false)
  })

  it('reads is_not as the negation of is, including for a contact with no value on file', () => {
    const rule = filters({ rules: [{ field: 'company', operator: 'is_not', values: ['Acme'] }] })

    expect(matchesFilters(rule, acme)).toBe(false)
    expect(matchesFilters(rule, contact({ speakerId: 'sp2', company: 'Globex' }))).toBe(true)
    expect(matchesFilters(rule, contact({ speakerId: 'sp3' }))).toBe(true)
  })
})

describe('matchesFilters: session fields', () => {
  const busy = contact({
    speakerId: 'sp1',
    sessions: [
      session({ submissionId: 'recSub1', trackId: 'recKeynote', format: 'Panel' }),
      session({ submissionId: 'recSub2', trackId: 'recPlatform', tagIds: ['recTagAi'] }),
    ],
  })

  it('matches when ANY session matches, never requiring all of them', () => {
    const rule = filters({ rules: [{ field: 'track', operator: 'is', values: ['recPlatform'] }] })

    expect(matchesFilters(rule, busy)).toBe(true)
  })

  it('matches a tag held by any one session', () => {
    const rule = filters({ rules: [{ field: 'tag', operator: 'is', values: ['recTagAi'] }] })

    expect(matchesFilters(rule, busy)).toBe(true)
    expect(
      matchesFilters(
        filters({ rules: [{ field: 'tag', operator: 'is', values: ['recTagX'] }] }),
        busy,
      ),
    ).toBe(false)
  })

  it('excludes the whole contact when is_not names a track any of their sessions is on', () => {
    // The documented reading: "Track is not Keynote" excludes the person, so `is` and
    // `is_not` partition the contacts and the busy speaker cannot qualify for both.
    const isNot = filters({
      rules: [{ field: 'track', operator: 'is_not', values: ['recKeynote'] }],
    })
    const is = filters({ rules: [{ field: 'track', operator: 'is', values: ['recKeynote'] }] })

    expect(matchesFilters(isNot, busy)).toBe(false)
    expect(matchesFilters(is, busy)).toBe(true)
  })

  it('passes a session-less contact through is_not and fails them on is', () => {
    const none = contact({ speakerId: 'sp9' })

    expect(
      matchesFilters(
        filters({ rules: [{ field: 'track', operator: 'is_not', values: ['recKeynote'] }] }),
        none,
      ),
    ).toBe(true)
    expect(
      matchesFilters(
        filters({ rules: [{ field: 'track', operator: 'is', values: ['recKeynote'] }] }),
        none,
      ),
    ).toBe(false)
  })

  it('compares track and tag ids exactly, since they are record ids rather than names', () => {
    const rule = filters({ rules: [{ field: 'track', operator: 'is', values: ['RECKEYNOTE'] }] })

    expect(matchesFilters(rule, busy)).toBe(false)
  })
})
