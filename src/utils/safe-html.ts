// Sanitize stored HTML on the way out of the DAL.
//
// Called from the mappers in src/services/airtable (`mapForm`, `mapFileRequest`), not from the
// components that render the value. Three things forced that placement, each measured on the
// deployed Worker rather than reasoned about:
//
//   1. An event admin is a CUSTOMER, not the operator. Three components set
//      `dangerouslySetInnerHTML` from an Airtable column, each arguing the sink was safe because
//      only an authenticated admin writes it. Running script in a public visitor's session, or in
//      another speaker's portal, crosses a privilege boundary regardless.
//   2. Each of those comments proposed sanitizing at the WRITE boundary if trust ever changed.
//      That cannot work: the editor's button guards and TipTap's parse rules are irrelevant to a
//      value typed straight into the Airtable cell, and Airtable is the source of truth that
//      several people can reach.
//   3. Sanitizing at the SINKS worked and cost too much. `OrganizerHtml` is reached from the public
//      wizard's client components, so it shipped the sanitizer into three client chunks, and the
//      raw markup still crossed to the browser inside the RSC payload.
//
// Implementation note, because the obvious library was tried and had to be dropped.
// `sanitize-html` does exactly this job and is battle-tested, but it depends on `postcss` for style
// parsing, and moving it server-side pushed the Worker script past Cloudflare's 3 MiB gzip limit:
// the deploy failed validation at 3142 KiB. `ultrahtml` is dependency-free and was rejected for a
// worse reason than size: its sanitize transformer does no scheme filtering at all, so it left
// `href="javascript:..."` untouched, and it mangled an unquoted attribute into a wrong value.
//
// So the parser is `htmlparser2`, which is what `sanitize-html` itself parses with and which
// carries no postcss, and the POLICY below is local. That split is deliberate: the genuinely hard
// part, turning a byte stream into tags and attributes, stays with a widely used parser, and the
// part specific to this app, which tags, attributes and style properties are permitted, is a short
// allowlist with a test for every case that used to reach a browser.

import { Parser } from 'htmlparser2'

/**
 * Exactly what the shared `RichTextEditor` can emit, plus what the portal's own editor adds.
 *
 * `span` is absent on purpose: TextAlign writes its style onto the block rather than a wrapper, so
 * a `span` in stored markup came from a paste and carries no formatting this app authored.
 */
const ALLOWED: Record<string, readonly string[]> = {
  p: [],
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  sup: [],
  sub: [],
  h1: [],
  h2: [],
  h3: [],
  ul: [],
  ol: [],
  li: [],
  hr: [],
  blockquote: [],
  code: [],
  pre: [],
  a: ['href', 'title', 'target'],
  img: ['src', 'alt', 'title', 'width', 'height'],
}

/** No closing tag, so they are never pushed onto the open-tag stack. */
const VOID = new Set(['br', 'hr', 'img'])

/**
 * Elements whose TEXT is dropped along with their tags.
 *
 * Without this the body of a `<script>` survives as visible page copy: confusing rather than
 * dangerous, but it reads as the sanitizer having failed.
 */
const STRIP_CONTENT = new Set(['script', 'style', 'textarea', 'option', 'noscript', 'title'])

/** URL-bearing attributes, which get scheme validation and not just escaping. */
const URL_ATTRS = new Set(['href', 'src'])

const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:']

/**
 * The style properties the editor writes, and the shapes it writes them in.
 *
 * `text-align` comes from the TextAlign extension and `margin-left` from the local `BlockIndent`
 * extension, which is how an indented paragraph survives a reload. Allowing `style` wholesale
 * reintroduces the sink through CSS: a fixed full-viewport block over the page is a clickjack with
 * no script tag in it. So each property is matched on its VALUE, not merely named.
 *
 * The patterns are alternations with no quantifier inside an optional group, because `\d+(\.\d+)?`
 * and its bounded forms are both flagged ReDoS-prone by the security lint rule. `.5` is the only
 * fraction `BlockIndent` can emit, since its step is 1.5rem.
 */
const STYLE_RULES: Record<string, RegExp> = {
  'text-align': /^(?:left|center|right|justify)$/u,
  'margin-left': /^(?:\d{1,2}|\d{1,2}\.5)rem$/u,
}

/** Absolute URL only, and only the three schemes above. A relative URL is refused. */
function safeUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value.trim())
    return ALLOWED_SCHEMES.includes(parsed.protocol) ? parsed.href : undefined
  } catch {
    // Not an absolute URL at all. Refusing rather than resolving is deliberate: a relative src in
    // stored markup came from a paste, and nothing in this app authors one.
    return undefined
  }
}

/**
 * The rule for one property, looked up without indexing a mutable record.
 *
 * A `Map` rather than `STYLE_RULES[property]`, because a bare index on an object keyed by
 * caller-supplied text is the object-injection shape the security lint rule refuses, and it is
 * refusing something real here: the property name comes out of stored markup.
 */
const STYLE_RULE_BY_PROPERTY = new Map(Object.entries(STYLE_RULES))

/** Keep declarations that match a rule, drop the rest, drop the attribute if none match. */
function safeStyle(value: string): string | undefined {
  const kept: string[] = []

  for (const declaration of value.split(';')) {
    const parts = declaration.split(':')
    if (parts.length !== 2) continue
    const property = (parts.at(0) ?? '').trim().toLowerCase()
    const raw = (parts.at(1) ?? '').trim()
    if (STYLE_RULE_BY_PROPERTY.get(property)?.test(raw) === true) kept.push(`${property}: ${raw}`)
  }

  return kept.length === 0 ? undefined : kept.join('; ')
}

/** Escape for a text node. `&` first, or the other replacements get double-escaped. */
function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Escape for a double-quoted attribute value. */
function escapeAttr(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;')
}

function safeAttrValue(name: string, value: string): string | undefined {
  if (name === 'style') return safeStyle(value)
  if (URL_ATTRS.has(name)) return safeUrl(value)
  return value
}

/** Same reasoning as `STYLE_RULE_BY_PROPERTY`: the tag name comes out of stored markup. */
const PERMITTED_BY_TAG = new Map(Object.entries(ALLOWED))

function serialiseAttrs(tag: string, attribs: Record<string, string>): string {
  const permitted = PERMITTED_BY_TAG.get(tag) ?? []
  const parts: string[] = []

  for (const [rawName, rawValue] of Object.entries(attribs)) {
    const name = rawName.toLowerCase()
    // `style` is permitted on every allowed tag; everything else is per-tag. An `on*` handler is
    // in neither list, which is what makes the entire event-handler surface unreachable.
    if (name !== 'style' && !permitted.includes(name)) continue

    const value = safeAttrValue(name, rawValue)
    if (value === undefined) continue
    parts.push(`${name}="${escapeAttr(value)}"`)
  }

  // An organizer's welcome message legitimately links out, and a bare `target="_blank"` hands
  // `window.opener` to whatever it opened.
  if (tag === 'a' && parts.some((part) => part.startsWith('href='))) {
    parts.push('rel="noopener noreferrer"')
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`
}

/**
 * Sanitize organizer-authored HTML.
 *
 * Returns a string safe to pass to `dangerouslySetInnerHTML`: only the tags and attributes above
 * survive, URLs must be absolute http/https/mailto, style is reduced to alignment and indentation,
 * and everything else including every event handler is dropped. Text inside a disallowed element
 * is kept, so a stripped `<a>` keeps its words, except for the content-stripping set.
 */
export function safeRichHtml(html: string): string {
  const out: string[] = []
  const openTags: string[] = []
  let stripDepth = 0

  const parser = new Parser(
    {
      onopentag: (name, attribs) => {
        const tag = name.toLowerCase()
        if (STRIP_CONTENT.has(tag)) {
          stripDepth += 1
          return
        }
        if (stripDepth > 0 || !PERMITTED_BY_TAG.has(tag)) return

        out.push(`<${tag}${serialiseAttrs(tag, attribs)}>`)
        // A void element never closes, so pushing it would misalign every later close.
        if (!VOID.has(tag)) openTags.push(tag)
      },
      ontext: (text) => {
        if (stripDepth === 0) out.push(escapeText(text))
      },
      onclosetag: (name) => {
        const tag = name.toLowerCase()
        if (STRIP_CONTENT.has(tag)) {
          stripDepth = Math.max(0, stripDepth - 1)
          return
        }
        if (stripDepth > 0 || VOID.has(tag)) return
        // Close only a tag we actually opened, so a stray or crossed close cannot unbalance the
        // output and let a later element escape its parent.
        if (openTags.at(-1) === tag) {
          openTags.pop()
          out.push(`</${tag}>`)
        }
      },
    },
    // `recognizeSelfClosing` so `<img />` is void rather than an element left open.
    { decodeEntities: true, recognizeSelfClosing: true, lowerCaseTags: true },
  )

  parser.write(html)
  parser.end()

  // Anything left open, closed in reverse. Unbalanced output would let the surrounding page layout
  // leak into the block, which is a visual defect rather than a security one, but still ours.
  while (openTags.length > 0) out.push(`</${String(openTags.pop())}>`)

  return out.join('')
}

/**
 * The optional-value form, for the DAL mappers.
 *
 * A separate export rather than making `safeRichHtml` accept undefined, so the render-side callers
 * keep a signature that cannot be handed a missing value by accident.
 */
export function safeStoredHtml(html: string | undefined): string | undefined {
  return html === undefined ? undefined : safeRichHtml(html)
}
