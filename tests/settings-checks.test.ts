// Event Details validation. This is the gate in front of the FIRST write path the
// Events table has ever had, so every rule here is a thing that breaks a live URL or
// an agenda render when it gets through:
//
//   - a bad slug lands in `/agenda/{slug}` and `/submit/{slug}/{formPublicId}`
//   - a duplicate slug makes `getEventBySlug` resolve to whichever row Airtable
//     sorts first (see the note on that read), so two events answer one URL
//   - an unrecognised timezone used to throw RangeError out of `Intl` across every
//     agenda surface; it falls back to UTC now, and Settings is where it gets typed
//   - reversed dates give the agenda's day tabs an empty range
//
// Driving these through a form post costs a round trip each, which is the reason
// they are unit tested instead.

import { describe, expect, it } from 'vitest'

import {
  checkEventDetails,
  firstProblemFor,
  hasBlockingProblem,
  slugTaken,
} from '@/features/settings/checks'
import type { EventDetailsDraft } from '@/features/settings/draft'

const VALID: EventDetailsDraft = {
  name: 'AI.Engineer Sandbox Event - NYC',
  slug: 'ai-engineer-sandbox',
  eventType: 'Conference',
  websiteUrl: 'ai.engineer',
  location: 'New York',
  timezone: 'America/Los_Angeles',
  startsAt: '2026-10-12T16:00:00.000Z',
  endsAt: '2026-10-14T24:00:00.000Z',
  theme: 'Test Event for NYC',
  logoUrl: '',
  backgroundUrl: '',
}

function messages(draft: EventDetailsDraft): readonly string[] {
  return checkEventDetails(draft).map((problem) => problem.message)
}

describe('checkEventDetails', () => {
  it('accepts the seeded event unchanged', () => {
    expect(checkEventDetails(VALID)).toEqual([])
    expect(hasBlockingProblem(checkEventDetails(VALID))).toBe(false)
  })

  it('requires a name', () => {
    expect(messages({ ...VALID, name: '   ' })).toContain('Event Name is required.')
  })

  it('requires a slug', () => {
    expect(messages({ ...VALID, slug: '' })).toContain('Event Slug is required.')
  })

  it('rejects a slug that is not lowercase kebab case', () => {
    for (const slug of ['AI Engineer', 'ai_engineer', 'ai engineer', '-leading', 'trailing-']) {
      expect(firstProblemFor(checkEventDetails({ ...VALID, slug }), 'slug')).toBeDefined()
    }
  })

  it('accepts digits and multiple segments in a slug', () => {
    expect(firstProblemFor(checkEventDetails({ ...VALID, slug: 'aie-2026-nyc' }), 'slug')).toBe(
      undefined,
    )
  })

  it('rejects a slug shorter than three characters or longer than eighty', () => {
    expect(firstProblemFor(checkEventDetails({ ...VALID, slug: 'ab' }), 'slug')).toBeDefined()
    expect(
      firstProblemFor(checkEventDetails({ ...VALID, slug: 'a'.repeat(81) }), 'slug'),
    ).toBeDefined()
  })

  it('requires both dates', () => {
    expect(messages({ ...VALID, startsAt: undefined })).toContain('Starts At is required.')
    expect(messages({ ...VALID, endsAt: undefined })).toContain('Ends At is required.')
  })

  it('rejects an end before the start', () => {
    const problems = checkEventDetails({
      ...VALID,
      startsAt: '2026-10-14T16:00:00.000Z',
      endsAt: '2026-10-12T16:00:00.000Z',
    })
    expect(firstProblemFor(problems, 'endsAt')?.message).toBe(
      'Ends At must be on or after Starts At.',
    )
  })

  it('allows a zero length event, because a single slot is a real event', () => {
    const same = '2026-10-12T16:00:00.000Z'
    expect(
      firstProblemFor(checkEventDetails({ ...VALID, startsAt: same, endsAt: same }), 'endsAt'),
    ).toBe(undefined)
  })

  it('rejects a timezone Intl does not recognise', () => {
    // The exact value that used to take out every agenda surface with a RangeError.
    const problems = checkEventDetails({ ...VALID, timezone: 'Pacific Time' })
    expect(firstProblemFor(problems, 'timezone')?.message).toBe(
      'Timezone must be a recognised IANA zone, such as America/New_York.',
    )
  })

  it('accepts UTC and a real IANA zone', () => {
    for (const timezone of ['UTC', 'America/New_York', 'Europe/Berlin', 'Asia/Tokyo']) {
      expect(firstProblemFor(checkEventDetails({ ...VALID, timezone }), 'timezone')).toBe(undefined)
    }
  })

  it('caps Theme at one thousand characters, matching the counter', () => {
    expect(firstProblemFor(checkEventDetails({ ...VALID, theme: 'x'.repeat(1000) }), 'theme')).toBe(
      undefined,
    )
    expect(
      firstProblemFor(checkEventDetails({ ...VALID, theme: 'x'.repeat(1001) }), 'theme'),
    ).toBeDefined()
  })

  it('accepts a website with or without a scheme and rejects one with whitespace', () => {
    for (const websiteUrl of ['', 'ai.engineer', 'https://ai.engineer/cfp']) {
      expect(firstProblemFor(checkEventDetails({ ...VALID, websiteUrl }), 'websiteUrl')).toBe(
        undefined,
      )
    }
    expect(
      firstProblemFor(checkEventDetails({ ...VALID, websiteUrl: 'ai engineer' }), 'websiteUrl'),
    ).toBeDefined()
    expect(
      firstProblemFor(checkEventDetails({ ...VALID, websiteUrl: 'notaurl' }), 'websiteUrl'),
    ).toBeDefined()
  })

  it('reports every problem at once rather than stopping at the first', () => {
    const problems = checkEventDetails({
      ...VALID,
      name: '',
      slug: 'Bad Slug',
      timezone: 'nope',
      endsAt: '2020-01-01T00:00:00.000Z',
    })
    expect(problems.map((problem) => problem.field).sort()).toEqual([
      'endsAt',
      'name',
      'slug',
      'timezone',
    ])
    expect(hasBlockingProblem(problems)).toBe(true)
  })
})

describe('slugTaken', () => {
  const others = [
    { id: 'recSelf', slug: 'ai-engineer-sandbox' },
    { id: 'recOther', slug: 'world-fair' },
  ]

  it('ignores the event being edited, so saving an unchanged slug is allowed', () => {
    expect(slugTaken('ai-engineer-sandbox', 'recSelf', others)).toBe(false)
  })

  it('reports a collision with another event', () => {
    expect(slugTaken('world-fair', 'recSelf', others)).toBe(true)
  })

  it('compares case insensitively and ignores surrounding space', () => {
    expect(slugTaken('  World-Fair ', 'recSelf', others)).toBe(true)
  })

  it('is false when nothing else holds the slug', () => {
    expect(slugTaken('brand-new', 'recSelf', others)).toBe(false)
  })
})
