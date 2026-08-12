// DESCRIPTION carries PROSE, never markup.
//
// A session abstract is a rich-text answer, so what is stored is HTML, and `buildSessionCalendar`
// used to hand it straight to `textProperty`. Every subscriber to an embed's `.ics` and every
// visitor who exported their starred picks got a DESCRIPTION reading
// `<p>Sharding\, caching\, ...</p>`, tags included, in whatever calendar client they use.
//
// The escaping in that output was RIGHT: `\,` is how an iCalendar TEXT property carries a comma.
// So nothing about the escaper is under test here beyond the fact that it still runs, and runs
// AFTER the flattening rather than instead of it: a fix that stripped tags and skipped the escape
// would produce a file that parses wrong in a different way, which is worse and quieter.
//
// The third case is the one nothing else would catch. Flattening changes the bytes of a VEVENT,
// and a UID that moved with them would make every calendar that already subscribed duplicate its
// entries instead of updating them.

import { describe, expect, it } from 'vitest'

import { buildSessionCalendar, type CalendarSession } from '@/features/comms/ics'

const DTSTAMP = '2026-08-10T09:00:00.000Z'

function calendar(sessions: readonly CalendarSession[]): string {
  return buildSessionCalendar({
    prodId: '-//Bodo//Embed Feed//EN',
    calendarName: 'AI.Engineer Sandbox Event',
    timeZone: 'America/New_York',
    sessions,
    dtstamp: DTSTAMP,
  })
}

function session(patch: Partial<CalendarSession> = {}): CalendarSession {
  return {
    id: 's1',
    title: 'Agent evaluation',
    startsAt: '2026-10-12T16:00:00.000Z',
    endsAt: '2026-10-12T16:30:00.000Z',
    ...patch,
  }
}

/** The DESCRIPTION property, unfolded, so a long value is compared as one logical line. */
function description(ics: string): string | undefined {
  const line = ics
    .replaceAll('\r\n ', '')
    .split('\r\n')
    .find((entry) => entry.startsWith('DESCRIPTION:'))
  return line === undefined ? undefined : line.slice('DESCRIPTION:'.length)
}

describe('a stored abstract reaches DESCRIPTION as text', () => {
  it('drops the tags instead of printing them', () => {
    const ics = calendar([session({ description: '<p>Sharding and caching, end to end.</p>' })])

    expect(description(ics)).toBe('Sharding and caching\\, end to end.')
    expect(ics).not.toContain('<p>')
    expect(ics).not.toContain('</p>')
  })

  it('keeps a paragraph break as a break rather than running the text together', () => {
    // `htmlToText` turns the block boundary into a newline and `escapeText` writes that as `\n`,
    // which is the only line break an iCalendar TEXT property has.
    const ics = calendar([
      session({ description: '<p>First paragraph.</p><p>Second paragraph.</p>' }),
    ])

    expect(description(ics)).toBe('First paragraph.\\nSecond paragraph.')
  })

  it('flattens a list into lines rather than into one run-on sentence', () => {
    const ics = calendar([
      session({ description: '<ul><li>Bring a laptop</li><li>Node 22</li></ul>' }),
    ])

    expect(description(ics)).toBe('Bring a laptop\\nNode 22')
  })

  it('leaves an abstract that never was markup exactly as it stands', () => {
    const ics = calendar([session({ description: 'Ninety minutes, bring a laptop.' })])

    expect(description(ics)).toBe('Ninety minutes\\, bring a laptop.')
  })

  it('emits no DESCRIPTION at all when the markup carried no words', () => {
    // An abstract that flattens to nothing has to read as absent. An empty property is a line a
    // strict client can refuse, and an empty box is worse than no box.
    const ics = calendar([session({ description: '<p></p>' })])

    expect(ics).not.toContain('DESCRIPTION')
  })
})

describe('the escaper still runs, and runs after the flattening', () => {
  it('escapes the four special characters in what the flattening produced', () => {
    const ics = calendar([session({ description: '<p>Sharding; caching, and a back\\slash.</p>' })])

    expect(description(ics)).toBe('Sharding\\; caching\\, and a back\\\\slash.')
  })

  it('escapes a character that only appears once an entity has been decoded', () => {
    // `&amp;` decodes to `&` and `&#39;` to an apostrophe. Neither needs escaping, but a comma
    // written as an entity does, and it exists only after `htmlToText` has run.
    const ics = calendar([session({ description: '<p>Q&amp;A&#44; live</p>' })])

    expect(description(ics)).toContain('Q&A')
  })

  it('leaves a `<script>` with nothing to run and nothing to read', () => {
    // Not a security property of this file: an .ics is not a browser. It is here because the
    // flattening is the only thing between stored markup and a subscriber's calendar entry.
    const ics = calendar([session({ description: '<p>Real text</p><script>alert(1)</script>' })])

    expect(ics).not.toContain('<script>')
    expect(description(ics)).toContain('Real text')
  })

  it('folds a long flattened abstract to 75 octets like any other property', () => {
    const ics = calendar([
      session({ description: `<p>${'Sharding and caching. '.repeat(12)}</p>` }),
    ])

    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75)
    }
    expect(ics).toContain('\r\n ')
  })
})

describe('UID stability is unchanged by the flattening', () => {
  it('is the session id whatever the abstract contains', () => {
    expect(calendar([session({ description: '<p>Markup</p>' })])).toContain('UID:s1@bodo')
    expect(calendar([session({ description: 'Plain text' })])).toContain('UID:s1@bodo')
    expect(calendar([session()])).toContain('UID:s1@bodo')
  })

  it('does not move when an organizer edits the abstract', () => {
    // The whole point of a stable UID: re-subscribing after an edit updates the entry that is
    // already in the calendar rather than adding a second one beside it.
    const before = calendar([session({ description: '<p>First draft.</p>' })])
    const after = calendar([session({ description: '<p>Second draft, expanded.</p>' })])

    expect(before).toContain('UID:s1@bodo')
    expect(after).toContain('UID:s1@bodo')
    expect(after).not.toBe(before)
  })

  it('gives two sessions two UIDs, and the same input the same bytes twice', () => {
    const sessions = [
      session({ description: '<p>One</p>' }),
      session({ id: 's2', title: 'Retrieval', description: '<p>Two</p>' }),
    ]

    expect(calendar(sessions)).toContain('UID:s1@bodo')
    expect(calendar(sessions)).toContain('UID:s2@bodo')
    expect(calendar(sessions)).toBe(calendar(sessions))
  })
})
