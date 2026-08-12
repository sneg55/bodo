// The `.html` representation: one plain document, no CSS and no JavaScript.
//
// This is the `Basic HTML` format, and the whole point of it is what it does NOT carry. The
// styled embed is a React page with a theme, custom properties, an organizer's extra CSS, a
// filter island and a client-side schedule builder. That is the right default and the wrong
// answer for a site with its own design system, for a page assembled at build time, and for a
// reader on a text browser or a screen reader that just wants the programme.
//
// So this emits semantic elements and nothing else: headings for the days, an article per
// session, a definition list for the fields the organizer left switched on. No class attributes,
// because a class with no stylesheet is noise, and a host page that wants to style this can
// select on the element names. No `<script>` and no `<style>`: a snippet that runs our code
// inside somebody else's page is a bigger promise than a feed should make, and it is the reason
// the iframe snippet exists for the styled format instead.
//
// Escaping goes through `escapeAttribute` for both attributes and text. It is stricter than a
// text node needs (it escapes quotes too) and that costs nothing, while having one escaper means
// there is no second one to forget at a call site.

import type { EmbedFeed, EmbedFeedSession, EmbedFeedSpeaker } from '@/features/cms/feed-model'
import { escapeAttribute } from '@/features/cms/snippet'
import { safeRichHtml } from '@/utils/safe-html'

export function embedFeedHtml(feed: EmbedFeed): string {
  const lines = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // Same rule as the styled page: the canonical page for this content is the organizer's own
    // website, and a bare feed competing with it in search results is a worse answer.
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${escapeAttribute(`${feed.event}: ${feed.viewLabel}`)}</title>`,
    '</head>',
    '<body>',
    `<h1>${escapeAttribute(feed.event)}</h1>`,
    ...sessionSection(feed),
    ...speakerSection(feed),
    '</body>',
    '</html>',
  ]
  return `${lines.join('\n')}\n`
}

function sessionSection(feed: EmbedFeed): readonly string[] {
  if (feed.sessions.length === 0) return []
  const lines = ['<section>', `<h2>${escapeAttribute(feed.viewLabel)}</h2>`]

  // The day heading is emitted when it CHANGES, which reproduces the grouped views' shape from
  // a flat list. The feed keeps schedule order, so a day cannot reappear after another one.
  let day: string | undefined
  for (const session of feed.sessions) {
    if (session.day !== undefined && session.day !== day) {
      day = session.day
      lines.push(`<h3>${escapeAttribute(day)}</h3>`)
    }
    lines.push(...sessionArticle(session))
  }

  lines.push('</section>')
  return lines
}

function sessionArticle(session: EmbedFeedSession): readonly string[] {
  return [
    '<article>',
    `<h4>${escapeAttribute(session.title)}</h4>`,
    ...definitions([
      ['Time', session.time],
      ['Format', session.format],
      ['Room', session.room],
      ['Track', session.track],
      ['Speakers', session.speakers?.join(', ')],
    ]),
    // The description is MARKUP and every other field here is plain text, which is why this one
    // line does not go through `escapeAttribute`. Escaped, it printed `<p>Sharding, caching...`
    // into the feed with its tags showing. Not wrapped in a `<p>` either: the value carries its
    // own block elements, and wrapping markup that starts with `<p>` in another one is invalid.
    //
    // Sanitized HERE as well as at the read, and that is not belt-and-braces for its own sake.
    // `describeSessions` is the only producer of a public description today, but this function
    // takes a plain `EmbedFeedSession` from anywhere and emits a document straight to a visitor,
    // so the safety of its output has to be decided by this file rather than assumed of its
    // caller. It costs nothing: `safeRichHtml` is idempotent, this runs on the server only, and
    // a feed is generated once per cached read rather than per visitor.
    ...(session.description === undefined ? [] : [safeRichHtml(session.description)]),
    '</article>',
  ]
}

function speakerSection(feed: EmbedFeed): readonly string[] {
  if (feed.speakers.length === 0) return []
  return [
    '<section>',
    `<h2>${escapeAttribute(feed.viewLabel)}</h2>`,
    ...feed.speakers.flatMap(speakerArticle),
    '</section>',
  ]
}

function speakerArticle(speaker: EmbedFeedSpeaker): readonly string[] {
  const sessions = speaker.sessions ?? []
  return [
    '<article>',
    `<h3>${escapeAttribute(speaker.name)}</h3>`,
    ...(speaker.headshotUrl === undefined
      ? []
      : [
          `<img src="${escapeAttribute(speaker.headshotUrl)}" alt="${escapeAttribute(speaker.name)}">`,
        ]),
    ...definitions([
      ['Tagline', speaker.tagline],
      ['Company', speaker.company],
    ]),
    // The biography is MARKUP, exactly as the session abstract above is, and it was escaped here
    // long after the abstract stopped being: the feed printed `<p>Priya Raman is a Principal
    // Engineer ... </p>` with its tags showing. Not wrapped in a `<p>` either, for the same reason
    // the abstract is not: the value carries its own block elements.
    //
    // Sanitized HERE as well as at the read, on the argument `sessionArticle` gives: this function
    // takes a plain `EmbedFeedSpeaker` from anywhere and writes a document straight to a visitor.
    ...(speaker.bio === undefined ? [] : [safeRichHtml(speaker.bio)]),
    ...(sessions.length === 0
      ? []
      : [
          '<ul>',
          ...sessions.map((session) => `<li>${escapeAttribute(sessionLine(session))}</li>`),
          '</ul>',
        ]),
    '</article>',
  ]
}

function sessionLine(session: { title: string; when?: string; room?: string }): string {
  return [session.title, session.when, session.room]
    .filter((part) => part !== undefined)
    .join(' - ')
}

/**
 * A `<dl>` of whatever survived Field Options, or nothing when none of it did.
 *
 * An empty definition list is not invalid, but it renders as a stray indent in every browser and
 * reads to a screen reader as a list with no items, so it is omitted instead.
 */
function definitions(pairs: readonly (readonly [string, string | undefined])[]): readonly string[] {
  const present = pairs.filter(
    (pair): pair is readonly [string, string] => pair[1] !== undefined && pair[1] !== '',
  )
  if (present.length === 0) return []
  return [
    '<dl>',
    ...present.flatMap(([term, value]) => [
      `<dt>${escapeAttribute(term)}</dt>`,
      `<dd>${escapeAttribute(value)}</dd>`,
    ]),
    '</dl>',
  ]
}
