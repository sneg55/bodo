// `Website Color Theme` and `Primary Color`, and how they reach the served page. R9.
//
// Reference: docs/parity/external-references.md, "Embed Style Options". The expanded panel shows a
// Select reading `Light` and a swatch plus hex input reading `#1b6ec2`. Both values are
// transcribed; the validation and the mechanism below are ours.
//
// THE HEX RULE IS SECURITY, not tidiness. The colour is emitted into the served page as a CSS
// custom property, so a cell holding `#fff; } body { display: none` would be a stylesheet
// injection that needs no `<` and that `safeEmbedCss` never sees, because it sanitizes a different
// column. `#rrggbb` and nothing else, enforced on the way out of the DAL as well as on the way in,
// for the reason src/utils/safe-html.ts gives: the Airtable cell is writable by hand, so the
// editor's input is not a boundary.
//
// The MECHANISM is two CSS custom properties on a wrapper element, not a hardcoded colour on the
// header band. `src/app/globals.css` defines `--primary` and `--primary-foreground` as the tokens
// `bg-primary` and `text-primary-foreground` resolve to, so overriding the pair on an ancestor
// recolours everything in the embed that uses them, and it keeps working if a later view paints
// something else primary. Hardcoding a colour on the band would be the same defect the ui-shadcn
// rule bans `bg-blue-600` for.
//
// The theme works the same way and it needs a WRAPPER: globals.css declares
// `@custom-variant dark (&:is(.dark *))`, so `dark` has to sit on an ANCESTOR of the elements it
// restyles, not on the element itself. `EmbedFrame` therefore renders an outer div for it.

import { EMBED_DEFAULTS, EMBED_THEMES, type EmbedTheme } from '@/types/cms'

/** Exactly `#rrggbb`. No short form, no alpha, no function, no name. */
const HEX = /^#[0-9a-f]{6}$/iu

/** The relative luminance below which a light foreground wins. Judged by eye, not by WCAG. */
const DARK_ENOUGH = 0.6

export function isEmbedHex(value: string): boolean {
  return HEX.test(value.trim())
}

/** Lower-cased, so one stored shape reaches the page and two cells cannot look different. */
export function normalizeEmbedHex(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * A stored colour, or the captured default.
 *
 * Falls back rather than dropping the value: an unset `--primary` leaves the header band painted
 * with whatever the page's own token is, which reads as a broken embed instead of as a colour
 * nobody chose.
 */
export function embedPrimaryColor(raw: string | undefined): string {
  if (raw === undefined || !isEmbedHex(raw)) return EMBED_DEFAULTS.primaryColor
  return normalizeEmbedHex(raw)
}

/** A stored theme, or the captured default. */
export function embedColorTheme(raw: string | undefined): EmbedTheme {
  return EMBED_THEMES.find((candidate) => candidate === raw) ?? EMBED_DEFAULTS.colorTheme
}

/**
 * The inline custom properties for the served embed's wrapper.
 *
 * Typed as a plain string record and spread into `style` by the caller. Every value here has been
 * through `embedPrimaryColor`, so nothing unvalidated can reach an inline style attribute.
 */
export function embedStyleVars(raw: string | undefined): Readonly<Record<string, string>> {
  const primary = embedPrimaryColor(raw)
  return {
    '--primary': primary,
    // Not `#fff` and `#000`: pure black on a mid colour is harsher than the token palette's own
    // pairing, and these two are what the light and dark token sets already use.
    '--primary-foreground': luminance(primary) < DARK_ENOUGH ? '#ffffff' : '#111111',
  }
}

/**
 * Perceived brightness, 0 to 1, from a validated `#rrggbb`.
 *
 * The sRGB coefficients rather than a plain average, because a mid green reads far lighter than a
 * mid blue at the same average and the header band's text has to stay readable on both.
 */
function luminance(hex: string): number {
  const red = channel(hex, 1)
  const green = channel(hex, 3)
  const blue = channel(hex, 5)
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255
}

function channel(hex: string, at: number): number {
  return Number.parseInt(hex.slice(at, at + 2), 16)
}
