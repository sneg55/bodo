// `Resources.bodyMarkdown` to a block list a React component can render.
//
// Why not markdown-to-HTML-then-innerHTML, which is the obvious shape: markdown allows
// raw HTML, so `marked.parse()` would hand back organizer markup that only
// `dangerouslySetInnerHTML` could render, and the body field would become a second
// stored-XSS surface with none of the iframe isolation the embed field gets
// (./embed.ts). Going through the token stream instead means the body can only ever
// produce the elements enumerated below.
//
// So the pipeline is: marked's LEXER (pure tokenizing, no HTML generation, and it runs on
// workerd because it touches no Node API) -> the block/span model here -> React elements
// in ./MarkdownBody.tsx. Two rules fall out of it and both are tested:
//
//   - `html` tokens are DROPPED. Markdown's raw-HTML passthrough is exactly the hole this
//     module exists to close, and the embed field is the sanctioned place for markup. The
//     editor says so, so an organizer who pastes a div is not left guessing.
//   - Link and image URLs are checked against a scheme allowlist, because `[x](javascript:...)`
//     is a perfectly valid markdown link and would otherwise become a working anchor.
//
// Deliberately unsupported, and worth naming so nobody assumes a bug: tables, footnotes,
// task lists, nested lists (a nested list flattens into its parent item's text), and
// inline HTML. R8 asks for speaker guides and venue info, and the escape hatch for
// anything richer is the embed.

import { Lexer, type MarkedToken, type Token, type Tokens } from 'marked'

export type MdSpan = {
  text: string
  strong?: boolean
  em?: boolean
  code?: boolean
  /** Already scheme-checked by `safeHref`. Absent means this span is not a link. */
  href?: string
}

export type MdBlock =
  | { kind: 'heading'; level: 2 | 3 | 4 | 5 | 6; spans: readonly MdSpan[] }
  | { kind: 'paragraph'; spans: readonly MdSpan[] }
  | { kind: 'quote'; spans: readonly MdSpan[] }
  | { kind: 'list'; ordered: boolean; items: readonly (readonly MdSpan[])[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }

/** The only schemes a body link may use. `javascript:` and `data:` are absent. */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:']

/**
 * Characters a browser discards while parsing a scheme, which is why they are stripped
 * before the scheme is examined: `java\tscript:` is `javascript:` to a browser, so testing
 * the raw text would classify it as having no scheme at all.
 */
const SCHEME_NOISE = /[\u0000-\u0020\u007f-\u009f]/gu

/**
 * A markdown link target, or `undefined` when it is not one this app will emit.
 *
 * Relative targets pass through UNCHANGED, including path-relative ones. That last part was
 * a real bug: only `/...` and `#...` were returned as written, so `guide.pdf` fell through to
 * the parse and came back as `https://bodo.invalid/guide.pdf`, a link to a dummy host that
 * exists only to give the parser a base. Found by Codex review. Not a security hole, just
 * every ordinary relative link broken.
 *
 * Anything WITH a scheme has to be in the allowlist, and the scheme is read off the value
 * with whitespace and control characters removed, so `java\tscript:` and `JavaScript:` are
 * both refused. That order matters: strip first, then classify, or the strip becomes the
 * bypass.
 */
export function safeHref(href: string): string | undefined {
  const trimmed = href.trim()
  if (trimmed === '') return undefined
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed

  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.exec(trimmed.replace(SCHEME_NOISE, ''))
  // No scheme, so it is a path-relative target and cannot carry executable content.
  if (scheme === null) return trimmed

  try {
    const parsed = new URL(trimmed, 'https://bodo.invalid')
    if (!SAFE_SCHEMES.includes(parsed.protocol)) return undefined
    // Re-serialised from the parse, so a control character smuggled into the scheme
    // cannot survive into the attribute.
    return parsed.href
  } catch {
    // Not a URL at all. Refused rather than guessed at.
    return undefined
  }
}

export function markdownBlocks(markdown: string): readonly MdBlock[] {
  const trimmed = markdown.trim()
  if (trimmed === '') return []
  return known(new Lexer().lex(trimmed)).flatMap(blockOf)
}

/**
 * marked's `Token` is `MarkedToken | Tokens.Generic`, and `Generic` has an `any` index
 * signature, so a `switch` on `token.type` narrows to "the real token OR Generic" and
 * every field read comes back as `any`. Filtering on the discriminant first is what makes
 * the rest of this file type-checked rather than cast: a token whose `type` is one of
 * marked's own IS a `MarkedToken`, and anything else could only come from a custom
 * extension, which this app does not register.
 */
const MARKED_TYPES: ReadonlySet<string> = new Set([
  'blockquote',
  'br',
  'code',
  'codespan',
  'def',
  'del',
  'em',
  'escape',
  'heading',
  'hr',
  'html',
  'image',
  'link',
  'list',
  'paragraph',
  'space',
  'strong',
  'table',
  'text',
])

function known(tokens: readonly Token[] | undefined): readonly MarkedToken[] {
  if (tokens === undefined) return []
  return tokens.filter((token): token is MarkedToken => MARKED_TYPES.has(token.type))
}

/**
 * A chain of `if`s rather than a `switch`, deliberately: `switch-exhaustiveness-check`
 * wants all nineteen of marked's token types enumerated even with a `default`, and
 * spelling out thirteen empty cases costs more than it documents. What is dropped is
 * named in the closing comment instead.
 */
function blockOf(token: MarkedToken): readonly MdBlock[] {
  if (token.type === 'heading') {
    return [{ kind: 'heading', level: headingLevel(token.depth), spans: spansOf(token.tokens) }]
  }
  if (token.type === 'paragraph') return [{ kind: 'paragraph', spans: spansOf(token.tokens) }]
  if (token.type === 'blockquote') return [{ kind: 'quote', spans: quoteSpans(token) }]
  if (token.type === 'list')
    return [{ kind: 'list', ordered: token.ordered, items: listItems(token) }]
  if (token.type === 'code') return [{ kind: 'code', text: token.text }]
  if (token.type === 'hr') return [{ kind: 'rule' }]

  // Everything else produces nothing. `html` is the raw-markup passthrough this module
  // exists to close, `table` and `def` have no element here, and the remainder are inline
  // or structural tokens that do not appear at block level.
  return []
}

/**
 * The page already owns the `<h1>`, so a top-level `#` renders as `<h2>`.
 *
 * Shifting rather than clamping keeps the outline intact: a document written with `#` and
 * `##` still has two distinct levels under the page title instead of collapsing to one.
 */
function headingLevel(depth: number): 2 | 3 | 4 | 5 | 6 {
  const shifted = depth + 1
  if (shifted <= 2) return 2
  if (shifted === 3) return 3
  if (shifted === 4) return 4
  if (shifted === 5) return 5
  return 6
}

function quoteSpans(token: Tokens.Blockquote): readonly MdSpan[] {
  return token.tokens.flatMap((child) =>
    child.type === 'paragraph' ? spansOf(child.tokens) : spansOf([child]),
  )
}

function listItems(token: Tokens.List): readonly (readonly MdSpan[])[] {
  return token.items.map((item) => spansOf(item.tokens))
}

/**
 * Inline tokens to a flat span list.
 *
 * Flat rather than a tree, because the only thing a body needs from nesting is which
 * marks apply to which run of text, and a tree makes the renderer recursive for no
 * visible gain. Marks accumulate as the walk descends, so `**bold _and italic_**` comes
 * out as two spans with `strong` on both.
 */
function spansOf(tokens: readonly Token[] | undefined, marks: MdSpan = { text: '' }): MdSpan[] {
  return known(tokens).flatMap((token): MdSpan[] => spanOf(token, marks))
}

/** Same `if` chain as `blockOf`, for the same exhaustiveness-rule reason. */
function spanOf(token: MarkedToken, marks: MdSpan): MdSpan[] {
  // A `text` token is a leaf in a paragraph and a BRANCH in a list item: marked wraps a
  // list item's inline content in a `text` token that carries its own `tokens` array, and
  // whose `text` is the raw source. Reading `.text` there rendered `**bold**` with literal
  // asterisks and, worse, would have put raw HTML back on the page as text.
  if (token.type === 'text' && token.tokens !== undefined) return spansOf(token.tokens, marks)
  if (token.type === 'text' || token.type === 'escape') return [{ ...marks, text: token.text }]
  if (token.type === 'strong') return spansOf(token.tokens, { ...marks, strong: true })
  if (token.type === 'em') return spansOf(token.tokens, { ...marks, em: true })
  if (token.type === 'del') return spansOf(token.tokens, marks)
  if (token.type === 'codespan') return [{ ...marks, code: true, text: token.text }]
  if (token.type === 'link') return linkSpans(token, marks)
  if (token.type === 'br') return [{ ...marks, text: '\n' }]
  // An image renders as the link its author wrote, with the alt text as the label.
  // Rendering an <img> would need either next/image (which cannot serve an arbitrary
  // remote host without a config entry per domain) or a bare <img>; the embed field is
  // where real media belongs.
  if (token.type === 'image') return linkSpans({ href: token.href, text: token.text }, marks)

  // Inline `html` is dropped for the same reason the block token is.
  return []
}

function linkSpans(token: { href: string; text: string }, marks: MdSpan): MdSpan[] {
  const href = safeHref(token.href)
  const text = token.text === '' ? token.href : token.text
  // A refused scheme keeps the label as plain text rather than dropping the words: the
  // sentence still reads, and nothing is clickable.
  return href === undefined ? [{ ...marks, text }] : [{ ...marks, href, text }]
}
