// Where an embed's rich text ends up, and what shape it has to be in when it gets there.
//
// Two columns are MARKUP: a session's abstract (a `wysiwyg` answer) and a speaker's biography
// (written in the portal's TipTap editor). Both were introduced as text, and the consumers were
// converted one at a time rather than swept, so each release left one sink behind still printing
// tags at a visitor. Three were found at once by the eval run: the speaker modal, the Basic HTML
// feed's biography, and the calendar feed's DESCRIPTION (covered in tests/ics-description-text).
//
// So this pins the RULE rather than the three instances. There are exactly two right answers for
// a rich-text value, and which one applies is decided by the format, not by the caller:
//
//   - An HTML sink takes SANITIZED HTML, produced on the way out of the READ, and renders it.
//   - Every other format takes flattened text.
//
// The negative half matters as much: `safeRichHtml` has to have actually run, or "renders as HTML"
// is just a stored-XSS sink with better manners. A speaker writes their own biography, and an
// embed renders on a page belonging to the conference rather than to us.
//
// Format is here for a different reason and rides along because it is the same three files: it is
// a LOCKED field on both session cards, the styled widget draws it, and all three feeds omitted it
// entirely, which made them a lossy copy of the page they exist to mirror.

import { describe, expect, it } from 'vitest'

import { embedFeedHtml } from '@/features/cms/feed-html'
import { embedFeed, embedFeedJson } from '@/features/cms/feed-model'
import { embedFeedXml } from '@/features/cms/feed-xml'
import { defaultEmbedFieldOptions, toggleEmbedField } from '@/features/cms/field-options'
import { EMPTY_EMBED_FILTERS } from '@/features/cms/filters'
import { type EmbedSourceRow, embedProjection } from '@/features/cms/projection'
import { EMBED_DEFAULTS, type EmbedFieldOptions, type EmbedView } from '@/types/cms'
import type { Room, Track } from '@/types/domain'

const GENERATED = '2026-08-10T09:00:00.000Z'

const ROOMS: readonly Room[] = [
  { id: 'recRoom1', eventId: 'recEvent', name: 'Main Stage', order: 0 },
]
const TRACKS: readonly Track[] = [
  { id: 'recTrack1', eventId: 'recEvent', name: 'Agents', color: 'blue', order: 0 },
]

/** The biography as the portal editor stores it: paragraphs, emphasis, a link. */
const PRIYA_BIO =
  '<p>Priya Raman is a <strong>Principal Engineer</strong> at Latticework.</p>' +
  '<p>She works on <a href="https://example.test/sharding">sharding</a>.</p>'

const PRIYA = {
  id: 'recPriya',
  firstName: 'Priya',
  lastName: 'Raman',
  tagline: 'Principal Engineer',
  company: 'Latticework',
  bio: PRIYA_BIO,
}

type SourceRow = EmbedSourceRow & { description?: string }

function row(patch: Partial<SourceRow> & { id: string; title: string }): SourceRow {
  return {
    status: 'accepted',
    scheduleStatus: 'published',
    calendarStatus: 'active',
    startsAt: '2026-10-12T16:00:00.000Z',
    endsAt: '2026-10-12T16:30:00.000Z',
    roomId: 'recRoom1',
    trackId: 'recTrack1',
    tagIds: [],
    format: 'lightning_talk',
    participants: [{ speaker: PRIYA }],
    ...patch,
  }
}

const ROWS: readonly SourceRow[] = [
  row({
    id: 's1',
    title: 'Agent evaluation',
    description: '<p>Sharding, caching, end to end.</p>',
  }),
]

function project(view: EmbedView, patch: { rows?: readonly SourceRow[] } = {}) {
  return projectWith(view, patch, defaultEmbedFieldOptions())
}

function projectWith(
  view: EmbedView,
  patch: { rows?: readonly SourceRow[] },
  fieldOptions: EmbedFieldOptions,
) {
  const projection = embedProjection({
    embed: {
      enabled: true,
      view,
      ...EMBED_DEFAULTS,
      filters: EMPTY_EMBED_FILTERS,
      fieldOptions,
    },
    event: { name: 'AI.Engineer Sandbox Event', timezone: 'America/New_York' },
    rows: patch.rows ?? ROWS,
    rooms: ROOMS,
    tracks: TRACKS,
    deepLink: {},
  })
  if (projection === undefined) throw new Error('expected a projection')
  return projection
}

function speakers(view: EmbedView, patch: { rows?: readonly SourceRow[] } = {}) {
  const body = project(view, patch).body
  return body.view === 'speaker_list' || body.view === 'speaker_gallery' ? body.speakers : []
}

describe('the biography leaves the read as sanitized HTML', () => {
  it('keeps its markup instead of arriving as a string of tags to print', () => {
    // The defect this replaces: the modal every list row and every gallery card opens rendered
    // `{speaker.bio}` as text, so a visitor read `<p>Priya Raman is a Principal Engineer ...`.
    const bio = speakers('speaker_list')[0]?.bio

    expect(bio).toContain('<strong>Principal Engineer</strong>')
    expect(bio).toContain('<p>')
    expect(bio).not.toContain('&lt;p&gt;')
  })

  it('reaches the gallery in exactly the same state as the list', () => {
    // One projection feeds both rosters and one dialog renders both, so a divergence here would
    // mean the fix landed on one of the two surfaces the eval named.
    expect(speakers('speaker_gallery')[0]?.bio).toBe(speakers('speaker_list')[0]?.bio)
  })

  it('has actually been through the sanitizer', () => {
    const hostile = {
      ...PRIYA,
      bio: '<p>Priya</p><script>alert(document.cookie)</script><img src="x" onerror="alert(1)">',
    }
    const bio = speakers('speaker_list', {
      rows: [row({ id: 's1', title: 'Talk', participants: [{ speaker: hostile }] })],
    })[0]?.bio

    expect(bio).toContain('<p>Priya</p>')
    expect(bio).not.toContain('script')
    expect(bio).not.toContain('onerror')
    // A relative `src` is refused outright rather than kept, so the `<img>` loses its attribute.
    expect(bio).not.toContain('src=')
  })

  it("adds `rel` to a link, because an embed renders on somebody else's page", () => {
    const bio = speakers('speaker_list')[0]?.bio ?? ''

    expect(bio).toContain('href="https://example.test/sharding"')
    expect(bio).toContain('rel="noopener noreferrer"')
  })

  it('reads as ABSENT when the markup carried no words at all', () => {
    // Not an empty string: the dialog branches on `bio !== undefined` to print `No biography yet.`,
    // and an empty rendered block instead of that line looks like a rendering fault.
    const blank = { ...PRIYA, bio: '<p></p><script>alert(1)</script>' }
    const speaker = speakers('speaker_list', {
      rows: [row({ id: 's1', title: 'Talk', participants: [{ speaker: blank }] })],
    })[0]

    expect(speaker).not.toHaveProperty('bio')
  })
})

describe('the Basic HTML feed prints the biography rather than escaping it', () => {
  it('emits the markup, not its tags as visible text', () => {
    // `escapeAttribute` was still wrapped round this one line long after the abstract beside it
    // stopped being escaped, so the feed printed `<p>Priya Raman is a Principal Engineer ...`.
    const html = embedFeedHtml(embedFeed(project('speaker_list'), GENERATED))

    expect(html).toContain('<strong>Principal Engineer</strong>')
    expect(html).not.toContain('&lt;p&gt;')
    // Not wrapped in a `<p>` of ours: the value carries its own block elements, and a paragraph
    // inside a paragraph is invalid markup that every browser reflows differently.
    expect(html).not.toContain('<p><p>')
  })

  it('sanitizes at this sink too, since it writes a document straight to a visitor', () => {
    const hostile = { ...PRIYA, bio: '<p>Priya</p><script>alert(1)</script>' }
    const html = embedFeedHtml(
      embedFeed(
        project('speaker_list', {
          rows: [row({ id: 's1', title: 'Talk', participants: [{ speaker: hostile }] })],
        }),
        GENERATED,
      ),
    )

    expect(html).toContain('<p>Priya</p>')
    expect(html).not.toContain('script')
  })

  it('omits the biography entirely when the Speaker card has Biography switched off', () => {
    const options = toggleEmbedField(defaultEmbedFieldOptions(), 'speaker', 'about', false)
    const feed = embedFeed(projectWith('speaker_list', {}, options), GENERATED)

    expect(feed.speakers[0]).not.toHaveProperty('bio')
    expect(embedFeedHtml(feed)).not.toContain('Latticework.')
  })
})

describe('the Format value reaches all three feeds', () => {
  const feed = () => embedFeed(project('agenda'), GENERATED)

  it('is on the model, labelled for display rather than as the stored value', () => {
    expect(feed().sessions[0]?.format).toBe('Lightning talk')
  })

  it('is in the JSON, where an eval agent read the key union of every session object', () => {
    const parsed = JSON.parse(embedFeedJson(feed())) as { sessions: { format?: string }[] }

    expect(parsed.sessions.map((session) => session.format)).toEqual(['Lightning talk'])
  })

  it('is an element in the XML and a definition in the HTML', () => {
    expect(embedFeedXml(feed())).toContain('<format>Lightning talk</format>')
    expect(embedFeedHtml(feed())).toContain('<dt>Format</dt>')
    expect(embedFeedHtml(feed())).toContain('<dd>Lightning talk</dd>')
  })

  it('reaches the flat Session List view as well as the day-grouped one', () => {
    // Both cards lock the field, so both feeds carry it. Only the layout differs.
    expect(embedFeed(project('session_list'), GENERATED).sessions[0]?.format).toBe('Lightning talk')
  })

  it('invents nothing for a submission that carries no Format', () => {
    const feed = embedFeed(
      project('agenda', { rows: [row({ id: 's1', title: 'Untyped', format: undefined })] }),
      GENERATED,
    )

    expect(feed.sessions[0]).not.toHaveProperty('format')
    expect(embedFeedXml(feed)).not.toContain('<format>')
    expect(embedFeedHtml(feed)).not.toContain('<dt>Format</dt>')
  })

  it('survives a stored blob that names no optional field, because it is a locked one', () => {
    const feed = embedFeed(
      projectWith('agenda', {}, { agenda: [], speaker: [], session: [] }),
      GENERATED,
    )

    expect(feed.sessions[0]?.format).toBe('Lightning talk')
    // Its deselectable neighbours are gone, which is what makes the assertion above mean anything.
    expect(feed.sessions[0]).not.toHaveProperty('room')
    expect(feed.sessions[0]).not.toHaveProperty('track')
  })
})

describe('the session abstract is unchanged by all of this', () => {
  it('is still sanitized HTML in the feed and still rendered as markup in the Basic HTML', () => {
    const feed = embedFeed(project('agenda'), GENERATED)

    expect(feed.sessions[0]?.description).toContain('<p>')
    expect(embedFeedHtml(feed)).toContain('Sharding, caching, end to end.')
    expect(embedFeedHtml(feed)).not.toContain('&lt;p&gt;')
  })
})
