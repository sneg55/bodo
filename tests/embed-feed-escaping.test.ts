// What organizer-supplied text does to a feed.
//
// Every string in an embed's output was typed by somebody: a session called `Q&A: <live>`, a room
// called `Studio "B"`, an abstract pasted out of a word processor with a stray control character
// in it. Each format breaks on a different one of those, and each break is silent where it
// happens:
//
//   - XML: an unescaped `&` or `<` makes the document unparseable, and a control character makes
//     it unparseable even ESCAPED, because XML 1.0 has no representation for one.
//   - HTML: an unescaped `<` in a title is markup injection into a stranger's page.
//
// The well-formedness check below is written out rather than taken from a parser dependency, and
// it is FALSIFIED first: the last describe block feeds it documents broken in each of the ways it
// claims to catch, and fails if it accepts them. A structural check nobody has seen reject
// anything is not evidence.

import { describe, expect, it } from 'vitest'

import { embedFeedHtml } from '@/features/cms/feed-html'
import { type EmbedFeed, embedFeed } from '@/features/cms/feed-model'
import { embedFeedXml } from '@/features/cms/feed-xml'
import { defaultEmbedFieldOptions } from '@/features/cms/field-options'
import { EMPTY_EMBED_FILTERS } from '@/features/cms/filters'
import { type EmbedSourceRow, embedProjection } from '@/features/cms/projection'
import { EMBED_DEFAULTS, type EmbedView } from '@/types/cms'
import type { Room, Track } from '@/types/domain'

const ROOMS: readonly Room[] = [
  { id: 'recRoom1', eventId: 'recEvent', name: 'Studio "B" & Annex', order: 0 },
]
const TRACKS: readonly Track[] = [
  { id: 'recTrack1', eventId: 'recEvent', name: '<Agents>', color: 'blue', order: 0 },
]

/** A NUL and a vertical tab, spelled by code point so no editor or formatter can eat them. */
const NUL = String.fromCodePoint(0)
const VERTICAL_TAB = String.fromCodePoint(11)
const HOSTILE_DESCRIPTION = `Pasted${NUL} text${VERTICAL_TAB}here & <b>bold</b>`

/**
 * `EmbedSourceRow` plus the abstract.
 *
 * `description` is not on `EmbedSourceRow`, but it IS what `readServedEmbed` puts on every row it
 * hands the projection (`describeSessions` lifts it out of `answersJson`) and what
 * `groupPublicSchedule` reads structurally. So it reaches the output, and a fixture that omitted
 * it would leave the Description field untested.
 */
type SourceRow = EmbedSourceRow & { description?: string }

const HOSTILE_ROWS: readonly SourceRow[] = [
  {
    id: 's1',
    title: 'Q&A: <live> "on stage"',
    status: 'accepted',
    scheduleStatus: 'published',
    calendarStatus: 'active',
    startsAt: '2026-10-12T16:00:00.000Z',
    endsAt: '2026-10-12T16:30:00.000Z',
    roomId: 'recRoom1',
    trackId: 'recTrack1',
    tagIds: [],
    description: HOSTILE_DESCRIPTION,
    participants: [{ speaker: { id: 'recAda', firstName: 'Ada & Co', lastName: '<Okafor>' } }],
  },
]

function hostileFeed(view: EmbedView = 'agenda'): EmbedFeed {
  const projection = embedProjection({
    embed: {
      enabled: true,
      view,
      ...EMBED_DEFAULTS,
      filters: EMPTY_EMBED_FILTERS,
      fieldOptions: defaultEmbedFieldOptions(),
    },
    event: { name: 'Bodo & Friends <2026>', timezone: 'America/New_York' },
    rows: HOSTILE_ROWS,
    rooms: ROOMS,
    tracks: TRACKS,
    deepLink: {},
  })
  if (projection === undefined) throw new Error('expected a projection')
  return embedFeed(projection, '2026-08-10T09:00:00.000Z')
}

describe('the XML feed stays well-formed', () => {
  it('parses with every hostile string in it', () => {
    expectWellFormed(embedFeedXml(hostileFeed()))
    expectWellFormed(embedFeedXml(hostileFeed('speaker_list')))
  })

  it('escapes rather than emits the characters that would end an element', () => {
    const xml = embedFeedXml(hostileFeed())

    expect(xml).toContain('<title>Q&amp;A: &lt;live&gt; "on stage"</title>')
    expect(xml).toContain('<room>Studio "B" &amp; Annex</room>')
    expect(xml).toContain('<track>&lt;Agents&gt;</track>')
  })

  it('drops control characters, which no escape can carry', () => {
    const xml = embedFeedXml(hostileFeed())

    expect(xml).toContain('Pasted texthere &amp; &lt;b&gt;bold&lt;/b&gt;')
    expect(xml).not.toContain(NUL)
    expect(xml).not.toContain(VERTICAL_TAB)
  })

  it('escapes an ampersand once, not twice', () => {
    expect(embedFeedXml(hostileFeed())).not.toContain('&amp;amp;')
  })
})

describe('the basic HTML feed', () => {
  it('escapes organizer text instead of letting it become markup', () => {
    const html = embedFeedHtml(hostileFeed())

    expect(html).toContain('Q&amp;A: &lt;live&gt; &quot;on stage&quot;')
    expect(html).not.toContain('<live>')
  })

  it('renders the description as markup, because that field alone is markup', () => {
    // The abstract is a `wysiwyg` answer, so escaping it printed `<b>bold</b>` into the feed
    // with its tags showing. Every OTHER field on the session is plain text and stays escaped,
    // which is what the assertions above pin.
    const html = embedFeedHtml(hostileFeed())

    expect(html).toContain('<b>bold</b>')
  })

  it('strips what the sanitizer refuses, so a description cannot smuggle script in', () => {
    const feed = hostileFeed()
    const hostile = {
      ...feed,
      sessions: feed.sessions.map((session) => ({
        ...session,
        description:
          '<p onclick="steal()">Fine.</p><script>alert(1)</script><a href="javascript:x">go</a>',
      })),
    }

    const html = embedFeedHtml(hostile)

    expect(html).toContain('<p>Fine.</p>')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('javascript:')
  })

  it('carries no script and no style, which is what makes it basic', () => {
    const html = embedFeedHtml(hostileFeed())

    expect(html).not.toContain('<script')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('class=')
  })

  it('names itself noindex, like the styled page it is an alternative to', () => {
    expect(embedFeedHtml(hostileFeed())).toContain('name="robots" content="noindex, nofollow"')
  })
})

describe('the well-formedness check itself rejects what it claims to', () => {
  it('rejects an unclosed element', () => {
    expect(() => {
      expectWellFormed('<a><b></a></b>')
    }).toThrow()
  })

  it('rejects a bare ampersand and a bare angle bracket in a text node', () => {
    expect(() => {
      expectWellFormed('<a>Q&A</a>')
    }).toThrow()
    expect(() => {
      expectWellFormed('<a>1 < 2</a>')
    }).toThrow()
  })

  it('rejects a raw quote inside an attribute value', () => {
    expect(() => {
      expectWellFormed('<a id="one"two"></a>')
    }).toThrow()
  })

  it('accepts the escaped forms of all of them', () => {
    expectWellFormed('<a id="one&quot;two">Q&amp;A &lt; 2 &#8212; ok</a>')
  })
})

const TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*?)(\/?)>/gu
const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);/gu

/**
 * A structural check: elements nest and close, attributes are quoted, and no text node carries a
 * character that would have to be an escape. Not a conforming parser, and it does not need to be:
 * these are the ways this serializer could produce something a real parser refuses.
 */
function expectWellFormed(xml: string): void {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/u, '')
  const stack: string[] = []
  let cursor = 0

  for (const match of body.matchAll(TAG)) {
    expectText(body.slice(cursor, match.index))
    cursor = match.index + match[0].length
    const closing = match[1]
    const name = match[2]
    expectAttributes(match[3])
    if (closing === '/') {
      expect(stack.pop()).toBe(name)
    } else if (match[4] !== '/') {
      stack.push(name)
    }
  }

  expectText(body.slice(cursor))
  expect(stack).toEqual([])
}

function expectText(text: string): void {
  expect(text).not.toContain('<')
  expect(text).not.toContain('>')
  expect(text.replace(ENTITY, '')).not.toContain('&')
}

/**
 * Every attribute is `name="value"`, and every value is escaped.
 *
 * Counted rather than matched with one pattern, because the obvious regex for a quoted attribute
 * list nests quantifiers, which is the shape `security/detect-unsafe-regex` refuses and a
 * backtracking hazard on the very input a check like this is pointed at.
 */
function expectAttributes(chunk: string): void {
  const quotes = [...chunk].filter((character) => character === '"').length
  const equals = [...chunk].filter((character) => character === '=').length
  expect(quotes).toBe(equals * 2)
  for (const [index, part] of chunk.split('"').entries()) {
    // The odd-numbered parts are the values; the even ones are the names between them.
    if (index % 2 === 1) expect(part.replace(ENTITY, '')).not.toContain('&')
  }
}
