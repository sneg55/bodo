// The pure half of the rich text primitive: the URL guard both the link and the image
// button apply, and the serialisation of the indent attribute.
//
// DOM-free on purpose. `vitest` runs `environment: 'node'` (vitest.config.mts) and this
// project has no DOM test environment, so anything about the editor that is worth a test
// has to live in a module that never touches `document`. What is worth a test here is the
// round trip: an indent written into `margin-left` has to come back as the same level when
// the stored HTML is parsed again, or reopening a form silently flattens it.
// See tests/rich-text-round-trip.test.ts.

/**
 * How deep indent goes. Eight steps is past any nesting an organizer will type, and the
 * clamp is what stops a held-down button from writing a 400rem margin into stored HTML.
 */
export const MAX_INDENT_LEVEL = 8

/** One step, in rem. `pl-5` is what the lists indent by, and 1.5rem reads the same. */
const INDENT_STEP_REM = 1.5

/** The same step in px, for markup that was authored somewhere that emits px. */
const INDENT_STEP_PX = 24

/** A `margin-left` value, in either unit, as it appears on a `style` attribute. */
const MARGIN_LEFT = /^(-?[\d.]+)(rem|em|px)$/u

/** Absolute http(s) only. Anything else is not a URL this editor will store. */
const HTTP_URL = /^https?:\/\/\S+$/u

/** A whole, in-range indent level. Anything unusable reads as no indent. */
export function clampIndent(level: number): number {
  if (!Number.isFinite(level)) return 0
  return Math.min(Math.max(Math.round(level), 0), MAX_INDENT_LEVEL)
}

/**
 * The `style` value an indented block renders with, or `undefined` at level 0.
 *
 * Undefined rather than `margin-left: 0rem`: every paragraph in the document carries this
 * attribute, so emitting a zero would put a style attribute on markup that has no
 * formatting, and the stored HTML of an untouched welcome message would change.
 */
export function indentStyle(level: number): string | undefined {
  const clamped = clampIndent(level)
  return clamped === 0 ? undefined : `margin-left: ${String(clamped * INDENT_STEP_REM)}rem`
}

/**
 * The level a stored `margin-left` came from. This is the reload half of the round trip,
 * so it has to accept what `indentStyle` writes and be forgiving about the rest: a value
 * in px, or in a unit nobody indents with, or absent.
 */
export function indentLevelFromStyle(marginLeft: string): number {
  const match = MARGIN_LEFT.exec(marginLeft.trim())
  if (match === null) return 0
  const step = match[2] === 'px' ? INDENT_STEP_PX : INDENT_STEP_REM
  return clampIndent(Number(match[1]) / step)
}

/**
 * The URL, trimmed, if it is one this editor will put in an `href` or an `img src`.
 *
 * Absolute http(s) and nothing else, and this is the reason the guard is a shared
 * function rather than a check at each button: a `javascript:` href stored in a welcome
 * message runs in the visitor's browser on the public form, and a `data:` image is the
 * same payload with a different tag. Relative paths are rejected too, because the markup
 * is rendered on other origins than the one it was authored on (the portal, an email).
 */
export function safeHttpUrl(raw: string): string | undefined {
  const trimmed = raw.trim()
  return HTTP_URL.test(trimmed) ? trimmed : undefined
}
