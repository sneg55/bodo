// The `.xml` representation of an embed's feed.
//
// Hand-written rather than pulled from a library, because the document is a fixed shape over a
// type that already exists (./feed-model) and the only hard part is escaping, which is 20 lines.
// A serializer dependency would be a Workers bundle cost for a `<title>` element.
//
// TWO THINGS MAKE THIS WELL-FORMED AND BOTH ARE ORGANIZER-SUPPLIED TEXT PROBLEMS:
//
//   1. `&`, `<` and `>` in a text node, plus `"` in an attribute value. A session called
//      `Q&A: <live>` is not exotic, it is Tuesday, and unescaped it ends the document.
//   2. Control characters. XML 1.0 forbids most of C0 outright, and there is no escape for
//      them: `&#x0;` is illegal too. A parser rejects the whole document, so they are DROPPED
//      rather than encoded. They reach us from pasted rich text often enough to matter.
//
// Element names are literals in this file and never come from data, so no name needs escaping.
//
// `description` and `bio` ARE MARKUP, and they are escaped here exactly like every other value.
// That is not the mistake it looks like next to ./feed-html, which emits them raw: an XML text
// node has no notion of nested markup, so `&lt;p&gt;` is how a well-formed document carries an
// HTML fragment, and a consumer decodes it and gets the fragment back. Emitting it unescaped
// would end the document at the first `<`.

import type { EmbedFeed, EmbedFeedSession, EmbedFeedSpeaker } from '@/features/cms/feed-model'

export function embedFeedXml(feed: EmbedFeed): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<embed view="${attribute(feed.view)}" generated="${attribute(feed.generatedAt)}">`,
    element(1, 'event', feed.event),
    element(1, 'viewLabel', feed.viewLabel),
    ...container(1, 'sessions', feed.sessions, sessionLines),
    ...container(1, 'speakers', feed.speakers, speakerLines),
    '</embed>',
  ]
  return `${lines.filter((line) => line !== '').join('\n')}\n`
}

function sessionLines(depth: number, session: EmbedFeedSession): readonly string[] {
  return [
    `${indent(depth)}<session id="${attribute(session.id)}">`,
    element(depth + 1, 'title', session.title),
    element(depth + 1, 'day', session.day),
    element(depth + 1, 'time', session.time),
    element(depth + 1, 'startsAt', session.startsAt),
    element(depth + 1, 'endsAt', session.endsAt),
    element(depth + 1, 'format', session.format),
    element(depth + 1, 'room', session.room),
    element(depth + 1, 'track', session.track),
    ...container(depth + 1, 'speakers', session.speakers ?? [], (child, name) => [
      element(child, 'speaker', name),
    ]),
    element(depth + 1, 'description', session.description),
    `${indent(depth)}</session>`,
  ]
}

function speakerLines(depth: number, speaker: EmbedFeedSpeaker): readonly string[] {
  return [
    `${indent(depth)}<speaker id="${attribute(speaker.id)}">`,
    element(depth + 1, 'name', speaker.name),
    element(depth + 1, 'tagline', speaker.tagline),
    element(depth + 1, 'company', speaker.company),
    element(depth + 1, 'headshotUrl', speaker.headshotUrl),
    element(depth + 1, 'bio', speaker.bio),
    ...container(depth + 1, 'sessions', speaker.sessions ?? [], (child, session) => [
      `${indent(child)}<session id="${attribute(session.id)}">`,
      element(child + 1, 'title', session.title),
      element(child + 1, 'when', session.when),
      element(child + 1, 'room', session.room),
      `${indent(child)}</session>`,
    ]),
    `${indent(depth)}</speaker>`,
  ]
}

/**
 * A wrapper element around a list, or nothing at all when the list is empty.
 *
 * Omitted rather than emitted empty, so a speaker roster's document does not carry a bare
 * `<sessions/>` under every entry whose Field Options turned them off.
 */
function container<T>(
  depth: number,
  name: string,
  items: readonly T[],
  write: (depth: number, item: T) => readonly string[],
): readonly string[] {
  if (items.length === 0) return []
  return [
    `${indent(depth)}<${name}>`,
    ...items.flatMap((item) => write(depth + 1, item)),
    `${indent(depth)}</${name}>`,
  ]
}

/** One leaf element, or an empty string when the value is absent, which the caller filters. */
function element(depth: number, name: string, value: string | undefined): string {
  if (value === undefined || value === '') return ''
  return `${indent(depth)}<${name}>${text(value)}</${name}>`
}

function indent(depth: number): string {
  return '  '.repeat(depth)
}

/**
 * A text node.
 *
 * `&` first, or every other escape's ampersand is escaped again and `&amp;` becomes `&amp;amp;`.
 * `>` is escaped although only `]]>` strictly requires it: a parser accepts either, and escaping
 * it means no reader has to reason about whether a `]]` preceded it.
 */
export function text(value: string): string {
  return strip(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** An attribute value. The quote characters matter here and only here. */
export function attribute(value: string): string {
  return text(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

/**
 * Characters XML 1.0 has no representation for at all.
 *
 * Tab, newline and carriage return are legal and kept; the rest of C0, plus the two permanently
 * unassigned noncharacters, are removed. Encoding them is not an option: `&#x1;` is as illegal
 * as the raw byte, so the only well-formed document is one without them.
 *
 * Written as a code-point walk rather than as a character class, because a regex over C0 is a
 * line of escape sequences that no reviewer can check by eye and that a formatter can mangle
 * into a NEGATED class, which would strip everything and pass every happy-path test.
 */
function strip(value: string): string {
  let out = ''
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    // Tab (9), line feed (10) and carriage return (13) are the three C0 characters XML allows.
    if (code === 9 || code === 10 || code === 13) {
      out += character
      continue
    }
    if (code < 32 || code === 0xfffe || code === 0xffff) continue
    out += character
  }
  return out
}
