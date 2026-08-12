// What the editor posts, validated. The write half of R9's three new sections.
//
// Its own module rather than more branches inside actions.ts, for two reasons. actions.ts is a
// `'use server'` file, so every export there is a callable endpoint and a parser has no business
// being one. And this is the boundary that decides what reaches a public page, so it is the part
// that has to be testable without a base: a Server Action is reachable by POST with no editor
// involved, so "the input is a colour picker" is not a guarantee about what arrives.
//
// EVERY FIELD FALLS BACK EXCEPT TWO. `name` and `primaryColor` are refused with a message, because
// both are things an organizer can see and fix: a blank name leaves an unlabelled row in the list,
// and a colour that is not a hex is a typo in a field that shows its own value. Everything else
// falls back to what is already stored, which is the safe direction for a form posted by something
// other than our editor: an unrecognised `view` or theme must not silently rewrite a working embed.
//
// `extraCss` is stored AS TYPED and sanitized on the way back out, which is the same split
// mapping-forms.ts uses for every HTML column. The write boundary is deliberately not the security
// boundary here: the Airtable cell is writable directly, so a sanitized write would guarantee
// nothing about what a reader gets, and it would also mean the editor could never show an organizer
// the code they actually wrote. The only thing done to it here is a length cap.

import { normalizeEmbedFieldOptions } from '@/features/cms/field-options'
import { normalizeEmbedFilters } from '@/features/cms/filters'
import { isEmbedHex, normalizeEmbedHex } from '@/features/cms/style-options'
import type { CmsEmbedEdit } from '@/services/airtable/to-fields-cms'
import {
  type CmsEmbed,
  EMBED_DATE_FORMATS,
  EMBED_FORMATS,
  EMBED_THEMES,
  EMBED_VIEWS,
  type EmbedFormat,
} from '@/types/cms'

/** A name longer than this is cut, not refused: it is an internal label. */
const NAME_LIMIT = 120

/** Matches the sanitizer's own budget, so nothing is stored that cannot be served. */
const CSS_LIMIT = 20_000

export type EmbedSaveResult = { ok: true; edit: CmsEmbedEdit } | { ok: false; message: string }

/**
 * The posted form, turned into the one write the DAL takes.
 *
 * `existing` supplies every fallback, so a field the post omitted keeps its stored value rather
 * than reverting to a global default. That distinction matters for `extraCss`: an ABSENT field
 * keeps the stored stylesheet, and a PRESENT but empty one clears it, which is what an organizer
 * emptying the editor means.
 */
export function parseEmbedSave(form: FormData, existing: CmsEmbed): EmbedSaveResult {
  const name = (field(form, 'name') ?? '').trim()
  if (name === '') return { ok: false, message: 'Name is required.' }

  const rawColor = (field(form, 'primaryColor') ?? existing.primaryColor).trim()
  if (!isEmbedHex(rawColor)) {
    return { ok: false, message: 'Primary Color must be a hex value such as #1b6ec2.' }
  }

  const css = extraCss(form, existing)

  return {
    ok: true,
    edit: {
      name: name.slice(0, NAME_LIMIT),
      // An unrecognised format falls back to the stored one rather than to `styled_html`, which
      // is the same rule every other vocabulary here follows: a hand-built post must not be able
      // to turn a JSON feed somebody's site is consuming back into an HTML page.
      format: choice(field(form, 'format'), EMBED_FORMATS) ?? existing.format,
      view: choice(field(form, 'view'), EMBED_VIEWS) ?? existing.view,
      // An HTML form reports an unchecked box by omitting it, which is what the editor mirrors.
      enabled: field(form, 'enabled') === 'on',
      colorTheme: choice(field(form, 'colorTheme'), EMBED_THEMES) ?? existing.colorTheme,
      primaryColor: normalizeEmbedHex(rawColor),
      dateTimeFormat:
        choice(field(form, 'dateTimeFormat'), EMBED_DATE_FORMATS) ?? existing.dateTimeFormat,
      ...(css === undefined ? {} : { extraCss: css }),
      // `existing` when the field is ABSENT, not the normalizer's default. These two arrive as
      // hidden JSON inputs, so absent means the client did not send them (a stale tab, a partial
      // post, a hand-built form) and never means the organizer cleared them. Falling back to the
      // default was a live-embed defect in one direction and a silent reset in the other: an empty
      // filter set is the BROADEST one, so an omitted `filters` republished every session the
      // organizer had filtered out, and an omitted `fieldOptions` switched every field they had
      // turned off back on. Found by Codex review.
      filters: withFallback(field(form, 'filters'), existing.filters, normalizeEmbedFilters),
      fieldOptions: withFallback(
        field(form, 'fieldOptions'),
        existing.fieldOptions,
        normalizeEmbedFieldOptions,
      ),
    },
  }
}

/**
 * The format alone, for the create action.
 *
 * `createEmbedAction` takes it as an argument rather than as a form field, and a Server Action
 * argument is as much "off the wire" as a form field is: the type says `EmbedFormat` and the
 * request says whatever it likes, so it goes through the same list as everything else.
 */
export function parseEmbedFormat(raw: string | undefined): EmbedFormat | undefined {
  return choice(raw, EMBED_FORMATS)
}

/**
 * The `Extra CSS Code` cell to write, or `undefined` to keep what is stored.
 *
 * An empty submitted value returns `''`, which `cmsEmbedEditFields` writes as a cleared cell. That
 * is the only way an organizer can remove custom CSS from a live embed, so it must not be confused
 * with the field having been omitted.
 */
/**
 * A posted JSON section, or the stored one when the post omitted it.
 *
 * Present-but-malformed still goes through the normalizer, which is right: a client that sent the
 * field is claiming to have edited it, and the normalizer's job is to make whatever arrived safe
 * to store. Only ABSENCE means "keep what is there".
 */
function withFallback<T>(raw: string | undefined, stored: T, normalize: (value: unknown) => T): T {
  return raw === undefined ? stored : normalize(json(raw))
}

function extraCss(form: FormData, existing: CmsEmbed): string | undefined {
  const raw = field(form, 'extraCss')
  // `extraCssRaw`, not `extraCss`: the latter is what `mapCmsEmbed` sanitized for rendering, and
  // writing it back would replace what the organizer typed with the served version of it.
  if (raw === undefined) return existing.extraCssRaw
  return raw.slice(0, CSS_LIMIT)
}

function choice<T extends string>(raw: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === raw)
}

/** A posted JSON field. Malformed reads as absent, and both normalizers have a documented default. */
function json(raw: string | undefined): unknown {
  if (raw === undefined || raw === '') return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function field(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' ? value : undefined
}
