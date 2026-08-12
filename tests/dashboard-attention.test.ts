// The event home's actionable banners (ref 36) and the profile gaps they count.
//
// Every case here is a wrong number on the first screen an organizer sees: a speaker
// counted once per accepted talk instead of once as a person, a banner that says "0 things
// need attention", or the same fact stated twice because the strip and the banner both
// claim it.

import { describe, expect, it } from 'vitest'
import type { SubmissionStatus } from '@/constants/status'
import { attentionBanners, profileGaps, stripEntries } from '@/features/dashboard/attention'
import { advisories } from '@/features/dashboard/home-view'

const href = (path: string) => `/admin/recEvent1${path}`

type Person = { id: string; bio?: string; headshotUrl?: string }
type Row = {
  status: SubmissionStatus
  startsAt?: string
  scheduleStatus: 'unscheduled' | 'scheduled' | 'published'
  participants: readonly { speaker: Person }[]
}

const person = (id: string, over: Partial<Person> = {}): Person => ({
  id,
  bio: 'Writes compilers.',
  headshotUrl: 'https://example.com/a.jpg',
  ...over,
})

const row = (over: Partial<Row> = {}): Row => ({
  status: 'accepted',
  scheduleStatus: 'unscheduled',
  participants: [],
  ...over,
})

describe('profileGaps', () => {
  it('counts nothing when there are no submissions', () => {
    expect(profileGaps([])).toEqual({ people: 0, bios: 0, headshots: 0 })
  })

  it('counts a speaker once even with several accepted submissions', () => {
    const ada = person('recAda', { bio: undefined, headshotUrl: undefined })
    const gaps = profileGaps([
      row({ participants: [{ speaker: ada }] }),
      row({ participants: [{ speaker: ada }] }),
      row({ participants: [{ speaker: ada }] }),
    ])

    expect(gaps).toEqual({ people: 1, bios: 1, headshots: 1 })
  })

  it('counts a person once in `people` while counting both of their gaps', () => {
    const gaps = profileGaps([
      row({ participants: [{ speaker: person('recAda', { bio: undefined }) }] }),
      row({ participants: [{ speaker: person('recChen', { headshotUrl: undefined }) }] }),
    ])

    expect(gaps).toEqual({ people: 2, bios: 1, headshots: 1 })
  })

  it('ignores speakers who are not on an accepted submission', () => {
    const pending = person('recHugo', { bio: undefined, headshotUrl: undefined })

    expect(profileGaps([row({ status: 'pending', participants: [{ speaker: pending }] })])).toEqual(
      {
        people: 0,
        bios: 0,
        headshots: 0,
      },
    )
  })

  it('treats a blank bio as missing, because Airtable stores whitespace as text', () => {
    const gaps = profileGaps([
      row({ participants: [{ speaker: person('recAda', { bio: '   ' }) }] }),
    ])

    expect(gaps).toEqual({ people: 1, bios: 1, headshots: 0 })
  })

  it('reports no gaps when every accepted speaker is complete', () => {
    const gaps = profileGaps([
      row({ participants: [{ speaker: person('recAda') }, { speaker: person('recChen') }] }),
    ])

    expect(gaps).toEqual({ people: 0, bios: 0, headshots: 0 })
  })
})

describe('attentionBanners', () => {
  it('returns nothing when nothing needs attention, rather than a zero banner', () => {
    expect(attentionBanners({ submissions: [], eventHref: href })).toEqual([])
  })

  it('renders the awaiting-decision banner with the reference wording', () => {
    const rows = [
      row({ status: 'pending' }),
      row({ status: 'pending' }),
      row({ status: 'pending' }),
    ]
    const banner = attentionBanners({ submissions: rows, eventHref: href }).at(0)

    expect(banner?.text).toBe('3 session submissions are awaiting a decision.')
    expect(banner?.actionLabel).toBe('Review submissions')
    expect(banner?.href).toBe('/admin/recEvent1/abstracts?tab=pending')
  })

  it('says "submission is" for one, so the banner is never ungrammatical', () => {
    const banner = attentionBanners({
      submissions: [row({ status: 'pending' })],
      eventHref: href,
    }).at(0)

    expect(banner?.text).toBe('1 session submission is awaiting a decision.')
  })

  it('spells out both gap counts the way ref 36 does', () => {
    const rows = [
      row({
        participants: [{ speaker: person('recAda', { bio: undefined, headshotUrl: undefined }) }],
      }),
      row({
        participants: [{ speaker: person('recChen', { bio: undefined, headshotUrl: undefined }) }],
      }),
    ]
    const banner = attentionBanners({ submissions: rows, eventHref: href }).at(0)

    expect(banner?.text).toBe(
      '2 accepted speakers are missing a bio or headshot (2 bios, 2 headshots).',
    )
    expect(banner?.actionLabel).toBe('View speakers')
  })

  it('drops the part of the parenthesis that is zero', () => {
    const rows = [
      row({ participants: [{ speaker: person('recAda', { headshotUrl: undefined }) }] }),
    ]
    const banner = attentionBanners({ submissions: rows, eventHref: href }).at(0)

    expect(banner?.text).toBe('1 accepted speaker is missing a bio or headshot (1 headshot).')
  })

  it('keeps every banner distinct by id, so React keys cannot collide', () => {
    const rows = [
      row({ status: 'pending' }),
      row({ participants: [{ speaker: person('recAda', { bio: undefined }) }] }),
    ]
    const ids = attentionBanners({ submissions: rows, eventHref: href }).map((entry) => entry.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('stripEntries', () => {
  it('drops the strip item a banner already states, as ref 36 does', () => {
    const rows = [row({ status: 'pending' }), row({ status: 'accepted', startsAt: undefined })]
    const banners = attentionBanners({ submissions: rows, eventHref: href })
    const kept = stripEntries(advisories({ submissions: rows, eventHref: href }), banners)

    expect(kept.map((entry) => entry.id)).toEqual(['unslotted'])
  })

  it('keeps every strip item when no banner covers one', () => {
    const rows = [row({ status: 'accepted', startsAt: undefined })]
    const entries = advisories({ submissions: rows, eventHref: href })

    expect(stripEntries(entries, [])).toEqual(entries)
  })
})
