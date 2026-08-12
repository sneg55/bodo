// `Date/Time Format`, and the one thing it must never do: show a visitor the wrong hour.
//
// Reference: docs/parity/external-references.md, "Embed Style Options". ONE option label is
// captured, verbatim: `English (US): Fri, June 3, 2022 at 11:00 PM`. That label is a specimen of
// its own output, which is what makes it testable: short weekday, long month, day, year, then
// `at`, then a 12-hour clock time. So the `en_us_long` shape below is transcribed off the label
// itself. `iso` is authored, and exists so the Select has two operable options rather than one.
//
// Every case here formats in the EVENT's timezone and never the runtime's. Workers run `Date` and
// `Intl` in UTC, so a bare `toLocaleString` anywhere on this path shows a 9am session at 4pm to
// every reader of the conference's own website.

import { describe, expect, it } from 'vitest'

import { embedDayLabel, embedStamp, embedTimeLabel } from '@/features/cms/date-format'

const NY = 'America/New_York'

describe('embedDayLabel', () => {
  it('renders the shape the captured option label specimens', () => {
    expect(embedDayLabel('2022-06-03', 'en_us_long')).toBe('Fri, June 3, 2022')
  })

  it('renders the ISO option as the date key itself', () => {
    expect(embedDayLabel('2022-06-03', 'iso')).toBe('2022-06-03')
  })

  it('keeps the undated bucket label under both formats', () => {
    expect(embedDayLabel('undated', 'en_us_long')).toBe('Time to be announced')
    expect(embedDayLabel('undated', 'iso')).toBe('Time to be announced')
  })

  it('hands back anything that is not a date key rather than inventing a date', () => {
    expect(embedDayLabel('not-a-day', 'iso')).toBe('not-a-day')
  })
})

describe('embedTimeLabel', () => {
  const slot = { startsAt: '2022-06-04T03:00:00.000Z', endsAt: '2022-06-04T04:00:00.000Z' }

  it('renders a 12-hour range for the captured option', () => {
    // 03:00Z on 4 June is 11:00 PM on 3 June in New York, which is the captured specimen's time.
    expect(embedTimeLabel(slot, NY, 'en_us_long')).toBe('11:00 PM - 12:00 AM')
  })

  it('renders a 24-hour range for the ISO option', () => {
    expect(embedTimeLabel(slot, NY, 'iso')).toBe('23:00 - 00:00')
  })

  it('formats in the event timezone and not the runtime one', () => {
    expect(embedTimeLabel(slot, 'Asia/Tokyo', 'iso')).toBe('12:00 - 13:00')
  })

  it('prints only the start when there is no end', () => {
    expect(embedTimeLabel({ startsAt: slot.startsAt }, NY, 'iso')).toBe('23:00')
    expect(embedTimeLabel({ startsAt: slot.startsAt }, NY, 'en_us_long')).toBe('11:00 PM')
  })

  it('is absent when the session has no start time', () => {
    expect(embedTimeLabel({}, NY, 'iso')).toBeUndefined()
  })

  it('is absent rather than wrong when the stored instant does not parse', () => {
    expect(embedTimeLabel({ startsAt: 'tomorrow' }, NY, 'iso')).toBeUndefined()
  })

  it('falls back to UTC rather than throwing on a timezone an organizer mistyped', () => {
    // `Events.timezone` is free text, and `Intl` throws a RangeError on anything it does not know.
    expect(embedTimeLabel(slot, 'Pacific Time', 'iso')).toBe('03:00 - 04:00')
  })
})

describe('embedStamp, the flat Session List row', () => {
  it('joins day and time with the word the captured label uses', () => {
    expect(embedStamp('Fri, June 3, 2022', '11:00 PM', 'en_us_long')).toBe(
      'Fri, June 3, 2022 at 11:00 PM',
    )
  })

  it('joins them with a space under ISO, which is how an ISO datetime reads', () => {
    expect(embedStamp('2022-06-03', '23:00', 'iso')).toBe('2022-06-03 23:00')
  })

  it('is just the day when the session has no time', () => {
    expect(embedStamp('2022-06-03', undefined, 'iso')).toBe('2022-06-03')
    expect(embedStamp('Fri, June 3, 2022', undefined, 'en_us_long')).toBe('Fri, June 3, 2022')
  })
})
