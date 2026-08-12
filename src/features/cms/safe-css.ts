// Sanitize the `Extra CSS Code` an organizer types, on the way OUT of the DAL.
//
// The reference is explicit that Sessionboard does not do this: "Sessionboard doesn't validate or
// provide custom code support. This can break existing styles. Recommended for expert users or
// developers only." That copy is transcribed verbatim into the editor's callout, and the behaviour
// behind it is deliberately NOT copied, because our embed is served from our own origin to
// visitors on a third-party website. Breaking your own styles is your business; running a script
// in somebody else's visitor's browser from our origin is ours.
//
// PLACEMENT IS THE POINT, and it is the placement src/utils/safe-html.ts argues for at length.
// This is called from `mapCmsEmbed`, at the read boundary, and not from the `<style>` sink:
//
//   1. An event admin is a CUSTOMER, not the operator. A guard on the editor's textarea protects
//      nobody, because the Airtable cell is writable directly and Airtable is the source of
//      truth several people can reach. A write-boundary check is worthless here for exactly the
//      reason it was worthless for stored HTML.
//   2. Sanitizing at the sink would put the sanitizer on the render path of a public page and
//      leave the raw blob in the RSC payload, which is the second half of the mistake safe-html
//      made and had to undo.
//
// NO NEW DEPENDENCY, and not because one was unavailable: a CSS parser exists, and the last
// dependency added for a sanitizing job (postcss, via sanitize-html) pushed the Worker past
// Cloudflare's 3 MiB gzip limit and failed the deploy at 3142 KiB. There is roughly 76 KiB of
// headroom. So the scanner below is local, about 120 lines, and every case it has to get right is
// pinned in tests/embed-safe-css.test.ts.
//
// FOUR RULES, in the order of how badly they fail:
//
//   1. NO `<` SURVIVES, anywhere, including inside CSS strings and comments. Inside a `<style>`
//      element the HTML tokenizer is in raw-text mode: it does not know what a CSS string or a
//      CSS comment is, so `content: "</style><script>"` really does close the element. Removing
//      the character is the only guard that does not depend on out-parsing a browser.
//   2. NOTHING FETCHES. `@import` is refused and so is every `url()`, `image-set()` and friend,
//      so an embed cannot pull in further CSS, cannot load a webfont or an image from an
//      attacker's host, and cannot report a visitor's IP or their having loaded the page.
//   3. THE OUTPUT IS BALANCED. Rules are re-serialised from a parse rather than passed through,
//      so a truncated or crafted blob cannot leave an open rule that swallows the page.
//   4. ORDINARY CSS STILL WORKS. Selectors, media queries, custom properties, nesting and
//      `!important` all survive. A sanitizer that eats real declarations is one that gets widened
//      back into uselessness by the next person who needs one.
//
// Known and accepted: a CSS ESCAPE in a declaration value is refused rather than decoded
// (`\75 rl(...)` is how `url` gets spelled past a naive filter), and a backslash in a SELECTOR is
// refused for the same reason. Both are legal CSS that nothing an organizer types needs.

/**
 * The budget, applied to the input before parsing AND to the output after it.
 *
 * Both, because re-serialising adds bytes (a declaration that arrived without its semicolon
 * leaves with one), so capping only the input lets a crafted cell come out longer than the cap.
 * The output is trimmed by dropping WHOLE top-level rules, never by cutting a string, so a page
 * at the limit still gets balanced CSS. This blob ships on every request for the embed.
 */
const MAX_LENGTH = 20_000

/** Nesting past this is dropped whole. No hand-written stylesheet reaches it. */
const MAX_DEPTH = 6

/**
 * At-rules that may keep their block. Everything else is dropped WITH its block.
 *
 * A denylist would be wrong here: `@import`, `@charset`, `@namespace` and `@font-face` are the
 * ones known to fetch today, and the at-rule namespace is open, so the next one is not on any
 * list yet. These four wrap ordinary declarations and cannot themselves load anything.
 */
const ALLOWED_AT_RULES = new Set(['media', 'supports', 'layer', 'container'])

/**
 * Value substrings that fetch, execute, or used to. Matched after whitespace collapsing.
 *
 * `src(` and `image(` were missing and are the same hole as `url(` with a different spelling.
 * CSS Values 4 defines `src()` as a url function that takes a STRING, and CSS Images 4 lets
 * `image()` take one too, so `background: src("https://evil.test/x.png")` fetched from an
 * attacker's host on a public page and reported every visitor's IP, without a single `url(` in
 * it. Both are matched as substrings, which also covers the vendor-prefixed spellings.
 * `image-set(` needs its own alternative because the hyphen stops `image\s*\(` matching it.
 * Found by Codex review, and independently while reading the file.
 */
const FETCHING_VALUE =
  /url\s*\(|src\s*\(|image\s*\(|image-set\s*\(|cross-fade\s*\(|element\s*\(|expression\s*\(|-moz-binding/iu

/**
 * `position` values that are refused, and the only place this file judges a value by meaning.
 *
 * `position: fixed` is measured against the VIEWPORT rather than the embed's own box, so
 * `a { position: fixed; inset: 0; opacity: 0; z-index: 2147483647 }` turns the feed's own footer
 * link into an invisible full-page overlay that swallows every click. Inside an iframe on the
 * organizer's site that is their business, and the file header says so; opened top-level at
 * `/embed/{publicId}` it is a clickjack served from OUR origin, which is the line this sanitizer
 * exists to hold. `sticky` is refused with it for the same reason at a smaller scale.
 *
 * `absolute` and `relative` stay: they are measured against an ancestor inside the embed, they are
 * what a badge or an overlaid label needs, and the worst they reach is the embed's own box.
 * Found by Codex review.
 */
const BANNED_POSITIONS = new Set(['fixed', 'sticky'])

/** Properties whose whole purpose is to load something. Both need `url()` anyway. */
const BANNED_PROPERTIES = new Set(['behavior', '-moz-binding', 'src'])

/** A property name, custom properties included, with their case preserved by the caller. */
const PROPERTY = /^(?:--[A-Za-z0-9_-]+|-{0,2}[A-Za-z][A-Za-z0-9-]*)$/u

/**
 * Every character a selector or an at-rule prelude may contain.
 *
 * An allowlist rather than a denylist because this string is re-emitted into the page. No
 * backslash, so a CSS escape cannot smuggle a character this class refuses.
 */
const PRELUDE = /^[A-Za-z0-9_\-#.,:*>+~()[\]="'^$|%/@&\s]+$/u

const AT_NAME = /^@([A-Za-z-]+)/u

/** Characters that would let a value escape its declaration or hide behind an escape. */
const UNSAFE_IN_VALUE = /[\\{}]/u

type Terminator = '{' | ';' | '}' | 'eof'
type Scan = { text: string; end: number; terminator: Terminator }

/** A rule body holds declarations (and nested rules); a stylesheet body holds rules only. */
type Context = 'stylesheet' | 'rule'

/**
 * Sanitize one organizer-authored stylesheet.
 *
 * Returns CSS safe to place inside a `<style>` element: brace-balanced, free of `<`, and free of
 * anything that fetches. An empty string means nothing in the input survived.
 */
export function safeEmbedCss(raw: string): string {
  // `<` for rule 1. NUL as well: the HTML tokenizer turns a stray NUL into a replacement
  // character rather than erroring, so it survives into the page and is one more byte a filter
  // can be hidden behind.
  const capped = raw.slice(0, MAX_LENGTH).replaceAll('<', '').replaceAll('\u0000', '')
  return sanitizeBody(stripComments(capped), 'stylesheet', 0)
}

/**
 * The optional-value form, for the DAL mapper.
 *
 * A blob that sanitizes to nothing reads as ABSENT rather than as an empty string, so the served
 * page omits the `<style>` element entirely instead of emitting an empty one on every request.
 */
export function safeStoredEmbedCss(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const css = safeEmbedCss(raw)
  return css === '' ? undefined : css
}

function sanitizeBody(css: string, context: Context, depth: number): string {
  if (depth > MAX_DEPTH) return ''
  let output = ''
  let index = 0

  // The budget is checked at the TOP LEVEL only, so what gets dropped when a cell is oversized is
  // always a whole rule and never half of one.
  while (index < css.length && (depth > 0 || output.length < MAX_LENGTH)) {
    const scan = readPrelude(css, index)
    const head = scan.text.trim()
    const block = scan.terminator === '{' ? readBlock(css, scan.end) : undefined

    if (block === undefined) {
      // A `;`-terminated or trailing fragment. In a rule that is a declaration; in a stylesheet
      // it is a statement at-rule (`@import`, `@charset`, `@namespace`) or invalid CSS, and both
      // are dropped. A stray `}` lands here too, with whatever preceded it.
      index = scan.terminator === 'eof' ? scan.end : scan.end + 1
      output += (context === 'rule' ? safeDeclaration(head) : undefined) ?? ''
      continue
    }

    index = block.end
    output += safeRule(head, block.body, depth) ?? ''
  }

  return output
}

/** One `prelude { body }`, re-serialised, or `undefined` when it is refused. */
function safeRule(head: string, body: string, depth: number): string | undefined {
  if (!PRELUDE.test(head)) return undefined

  const atRule = head.startsWith('@')
  if (atRule && !ALLOWED_AT_RULES.has(atName(head))) return undefined

  const inner = sanitizeBody(body, atRule ? 'stylesheet' : 'rule', depth + 1)
  // An empty rule is dropped rather than emitted, which is also what makes a rule whose every
  // declaration fetched something disappear instead of leaving `.a{}` behind.
  return inner === '' ? undefined : `${collapse(head)}{${inner}}`
}

/** One `property: value`, re-serialised with its semicolon, or `undefined`. */
function safeDeclaration(text: string): string | undefined {
  const colon = text.indexOf(':')
  if (colon <= 0) return undefined

  const property = text.slice(0, colon).trim()
  const value = collapse(text.slice(colon + 1).trim())

  if (!PROPERTY.test(property) || BANNED_PROPERTIES.has(property.toLowerCase())) return undefined
  if (value === '' || FETCHING_VALUE.test(value) || UNSAFE_IN_VALUE.test(value)) return undefined
  if (!balanced(value)) return undefined
  if (property.toLowerCase() === 'position' && BANNED_POSITIONS.has(firstWord(value))) {
    return undefined
  }
  return `${property}:${value};`
}

/** The first whitespace-separated token, lowercased. `position: fixed !important` is `fixed`. */
function firstWord(value: string): string {
  return (value.split(' ').at(0) ?? '').toLowerCase()
}

/**
 * Every `(` and `[` in the value is closed, in order.
 *
 * Rule 3 in the header (the output is balanced) was only true of BRACES. The scanner tracks
 * strings and braces but not function delimiters, so `.a { color: rgb(0 }` was re-serialised as
 * `.a{color:rgb(0;}`, and a CSS parser then consumes the closing brace and every rule after it
 * into the unterminated function until end of input: one truncated declaration silently swallowed
 * the rest of the organizer's stylesheet. Refusing the declaration keeps the promise the header
 * makes, and costs nothing real, since a value with an unclosed function is not valid CSS anyway.
 * Found by Codex review.
 */
function balanced(value: string): boolean {
  const open: string[] = []
  for (const character of value) {
    if (character === '(' || character === '[') open.push(character)
    if (character === ')' && open.pop() !== '(') return false
    if (character === ']' && open.pop() !== '[') return false
  }
  return open.length === 0
}

function atName(head: string): string {
  return (AT_NAME.exec(head)?.at(1) ?? '').toLowerCase()
}

function collapse(value: string): string {
  return value.replaceAll(/\s+/gu, ' ')
}

/**
 * Read up to the next `{`, `;` or `}`, skipping over quoted strings.
 *
 * Strings are skipped because a `{` inside `content: "{"` is not a block opener, and mistaking
 * one for a block is how a scanner loses track of where it is and re-emits unbalanced output.
 */
function readPrelude(css: string, from: number): Scan {
  let index = from
  while (index < css.length) {
    const character = css.charAt(index)
    if (character === '"' || character === "'") {
      index = skipString(css, index)
      continue
    }
    if (character === '{' || character === ';' || character === '}') {
      return { text: css.slice(from, index), end: index, terminator: terminatorOf(character) }
    }
    index += 1
  }
  return { text: css.slice(from, index), end: index, terminator: 'eof' }
}

function terminatorOf(character: string): Terminator {
  if (character === '{') return '{'
  if (character === ';') return ';'
  return '}'
}

/**
 * The body of the block opening at `open`, and the index after its closing brace.
 *
 * An unclosed block yields everything to the end of the input, which is what makes a truncated
 * cell come back out balanced: the parse ends and the serialiser writes the brace.
 */
function readBlock(css: string, open: number): { body: string; end: number } {
  let depth = 0
  let index = open

  while (index < css.length) {
    const character = css.charAt(index)
    if (character === '"' || character === "'") {
      index = skipString(css, index)
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return { body: css.slice(open + 1, index), end: index + 1 }
    }
    index += 1
  }
  return { body: css.slice(open + 1), end: css.length }
}

/**
 * Drop `/* ... *\/` comments, preserving strings.
 *
 * Done before parsing because a comment can otherwise hide a brace from the scanner, and a
 * comment is also where a hostile blob hides the second half of a rule.
 */
function stripComments(css: string): string {
  const out: string[] = []
  let index = 0

  while (index < css.length) {
    const character = css.charAt(index)
    if (character === '"' || character === "'") {
      const end = skipString(css, index)
      out.push(css.slice(index, end))
      index = end
      continue
    }
    if (character === '/' && css.startsWith('/*', index)) {
      const close = css.indexOf('*/', index + 2)
      index = close === -1 ? css.length : close + 2
      continue
    }
    out.push(character)
    index += 1
  }

  return out.join('')
}

/** The index after the string starting at `at`. An unterminated string runs to the end. */
function skipString(css: string, at: number): number {
  const quote = css.charAt(at)
  let index = at + 1

  while (index < css.length) {
    const character = css.charAt(index)
    if (character === '\\') {
      index += 2
      continue
    }
    if (character === quote) return index + 1
    index += 1
  }
  return index
}
