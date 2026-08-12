// The ⌘K palette's result rules.
//
// This file exists because the palette shipped as a control that could not answer: the
// dialog was complete, `searchGroups` defaulted to `[]`, and no caller ever passed it, so
// `Find or ask` replied `No results found.` on every admin page. Nothing failed, no test
// covered it, and it survived several revisions of the parity report as a tick. So the two
// properties pinned hardest here are the two that would let it regress to that state
// silently: that a real match produces a real item, and that a capped group SAYS it was
// capped instead of looking identical to a complete one.

import { describe, expect, it } from 'vitest'
import {
  GROUP_LIMIT,
  globalSearchGroups,
  MIN_QUERY_LENGTH,
  normalizeQuery,
} from '@/features/search/global-search'
import { navSearchGroup } from '@/features/search/nav-targets'
import type { Speaker, SubmissionWithParticipants } from '@/types/domain'
import type { GlobalSearchGroup, GlobalSearchItem } from '@/types/search'

import { EVENT, itemsOf, participant, speaker, submission } from './helpers/search-fakes'

describe('normalizeQuery', () => {
  it('trims and lowercases, so matching is case-insensitive on both sides', () => {
    expect(normalizeQuery('  Kubernetes  ')).toBe('kubernetes')
  })
})

describe('globalSearchGroups, the short-query guard', () => {
  it('returns nothing below the minimum length', () => {
    // One character matches most of an event, which is not a search result, it is a dump.
    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [submission()],
      speakers: [speaker()],
      query: 'S',
    })

    expect(groups).toEqual([])
  })

  it('returns nothing for whitespace, which is what a cleared input sends', () => {
    expect(
      globalSearchGroups({
        eventId: EVENT,
        submissions: [submission()],
        speakers: [speaker()],
        query: '   ',
      }),
    ).toEqual([])
  })

  it('searches at exactly the minimum length', () => {
    // The boundary itself, because an off-by-one here means the palette ignores a
    // two-character query and looks broken again.
    expect('SE'.length).toBe(MIN_QUERY_LENGTH)
    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [submission()],
      speakers: [],
      query: 'SE',
    })

    expect(itemsOf(groups, 'submissions')).toHaveLength(1)
  })
})

describe('globalSearchGroups, what a submission matches on', () => {
  it('matches the code, and links to the row rather than to the list', () => {
    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [submission()],
      speakers: [],
      query: 'sess-14',
    })

    expect(itemsOf(groups, 'submissions')).toEqual([
      {
        id: 'recSub1',
        label: 'Scaling inference on a budget',
        description: 'SESS-14',
        href: `/admin/${EVENT}/abstracts?q=SESS-14`,
        // Empty because this fixture has no participants. It is still PRESENT, because
        // cmdk filters the client list on this field and an absent one is what used to
        // drop a talk found by its speaker's name.
        keywords: '',
      },
    ])
  })

  it('matches the title mid-word, because a substring is what cmdk can also match', () => {
    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [submission()],
      speakers: [],
      query: 'inference',
    })

    expect(itemsOf(groups, 'submissions')).toHaveLength(1)
  })

  it('matches a participant speaker by name', () => {
    const withParticipant = submission({
      participants: [participant({ firstName: 'Grace', lastName: 'Hopper' })],
    })

    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [withParticipant],
      speakers: [],
      query: 'hopper',
    })

    expect(itemsOf(groups, 'submissions')).toHaveLength(1)
  })

  it('carries the participant names it matched on, so the client filter keeps the row', () => {
    // THE HALF THAT WAS INVISIBLE. cmdk re-filters this set in the browser against each
    // item's value, and the palette builds that value from the label and description only.
    // A talk matched on a participant's name has that name in neither its title nor its
    // code, so the server found it and the browser threw it away: searching a person
    // returned the person and none of their talks. `keywords` is what the value now also
    // carries. If this is ever dropped, the row vanishes on arrival and nothing errors.
    const withParticipant = submission({
      participants: [participant({ firstName: 'Grace', lastName: 'Hopper' })],
    })

    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [withParticipant],
      speakers: [],
      query: 'hopper',
    })

    expect(itemsOf(groups, 'submissions').at(0)?.keywords).toContain('Grace Hopper')
  })

  it('percent-encodes the code it puts in the query string', () => {
    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [submission({ code: 'A&B 2' })],
      speakers: [],
      query: 'a&b',
    })

    expect(itemsOf(groups, 'submissions').at(0)?.href).toBe(`/admin/${EVENT}/abstracts?q=A%26B%202`)
  })

  it('omits the group entirely when nothing matches, rather than sending an empty heading', () => {
    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [submission()],
      speakers: [],
      query: 'nothing here',
    })

    expect(groups).toEqual([])
  })
})

describe('globalSearchGroups, what a speaker matches on', () => {
  it('matches a full name spanning the first and last field', () => {
    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [],
      speakers: [speaker()],
      query: 'ada lovelace',
    })

    expect(itemsOf(groups, 'speakers')).toHaveLength(1)
  })

  it('matches the email, and shows it as the description', () => {
    // Load-bearing for the client: cmdk filters again on a value that includes the
    // description, so a hit matched on email survives only because email is shown.
    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [],
      speakers: [speaker()],
      query: 'ada@example',
    })

    expect(itemsOf(groups, 'speakers').at(0)?.description).toBe('ada@example.com')
  })

  it('matches the company', () => {
    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [],
      speakers: [speaker({ company: 'Analytical Engines Ltd' })],
      query: 'analytical',
    })

    expect(itemsOf(groups, 'speakers')).toHaveLength(1)
  })

  it('tolerates a speaker with no company, which is the common case', () => {
    expect(() =>
      globalSearchGroups({
        eventId: EVENT,
        submissions: [],
        speakers: [speaker({ company: undefined })],
        query: 'ada',
      }),
    ).not.toThrow()
  })

  it('opens the PERSON, not one of their talks', () => {
    // A row filed under `Speakers` and labelled with a name and an email used to open the
    // Abstracts list filtered to that name, because there was no speaker route when this
    // was written. For anyone with a single accepted talk the filtered list showed exactly
    // that talk, so the palette looked like it opened the abstract. A row's label and its
    // destination have to agree, and the id is the address: a name was a query string.
    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [],
      speakers: [speaker({ id: 'recSpk9' })],
      query: 'ada',
    })

    expect(itemsOf(groups, 'speakers').at(0)?.href).toBe('/admin/crm/recSpk9')
  })

  it('returns the person AND their talk as separate rows for one query', () => {
    // What the report asked for. The two used to collapse into a single Speakers row: the
    // submission WAS selected here, and then cmdk dropped it in the browser for want of the
    // name in its value. Both halves have to hold for the palette to answer this query.
    const groups = globalSearchGroups({
      eventId: EVENT,
      submissions: [submission({ participants: [participant()] })],
      speakers: [speaker()],
      query: 'lovelace',
    })

    expect(itemsOf(groups, 'speakers')).toHaveLength(1)
    expect(itemsOf(groups, 'submissions')).toHaveLength(1)
    expect(itemsOf(groups, 'submissions').at(0)?.keywords).toContain('Ada Lovelace')
  })
})

describe('globalSearchGroups, the overflow row', () => {
  const many = Array.from({ length: GROUP_LIMIT + 5 }, (_, index) =>
    submission({ id: `recSub${index}`, code: `SESS-${index}`, title: `Inference talk ${index}` }),
  )

  it('caps the group and adds one row that names the real total', () => {
    const items = itemsOf(
      globalSearchGroups({ eventId: EVENT, submissions: many, speakers: [], query: 'inference' }),
      'submissions',
    )

    expect(items).toHaveLength(GROUP_LIMIT + 1)
    expect(items.at(-1)?.label).toBe(`See all ${GROUP_LIMIT + 5} matching submissions`)
  })

  it('sends the overflow row to the list filtered by the query, not by one code', () => {
    const items = itemsOf(
      globalSearchGroups({ eventId: EVENT, submissions: many, speakers: [], query: 'inference' }),
      'submissions',
    )

    expect(items.at(-1)?.href).toBe(`/admin/${EVENT}/abstracts?q=inference`)
  })

  it('adds no overflow row when the matches fit exactly', () => {
    // The boundary that decides whether a complete result set gets labelled as truncated.
    const exactly = many.slice(0, GROUP_LIMIT)
    const items = itemsOf(
      globalSearchGroups({
        eventId: EVENT,
        submissions: exactly,
        speakers: [],
        query: 'inference',
      }),
      'submissions',
    )

    expect(items).toHaveLength(GROUP_LIMIT)
    expect(items.every((item) => item.label.startsWith('Inference talk'))).toBe(true)
  })

  it('does not promise a filtered speaker list, because no such surface exists', () => {
    const speakers = Array.from({ length: GROUP_LIMIT + 2 }, (_, index) =>
      speaker({ id: `recSpk${index}`, email: `ada${index}@example.com` }),
    )
    const items = itemsOf(
      globalSearchGroups({ eventId: EVENT, submissions: [], speakers, query: 'ada' }),
      'speakers',
    )

    expect(items.at(-1)?.label).toBe(`${GROUP_LIMIT + 2} speakers match. Open the task board`)
    expect(items.at(-1)?.href).toBe(`/admin/${EVENT}/tasks`)
  })
})

// `navSearchGroup` is covered separately in `global-search-nav.test.ts`: it reads the nav
// tree rather than event data, so it shares none of the fixtures above.
