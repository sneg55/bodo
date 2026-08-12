'use server'

// R9's writes, and every one of them authorizes for itself.
//
// The order below is the security property and not a style, and it is the same order
// @/features/resources/actions uses:
//
//   1. `requireEventRole(eventId, 'admin')`. Capability comes from EventMemberships on every
//      call, never from the session cookie, so removing somebody from the event takes effect on
//      their next request rather than when a 30 day token expires. A REVIEWER is refused by every
//      export here: `EVENT_ROLES` ranks admin above reviewer, and an embed is a public data feed
//      on the conference's own website, not a review capability.
//   2. `ownedEmbed`, which loads the row and checks its event link (./authorize).
//   3. Validate the posted values.
//   4. Write, and let the DAL expire both `event:{id}:embeds` and `embed:{publicId}`.
//
// Step 1 is here and not only in `(admin)/admin/[eventId]/layout.tsx` because a Server Action is
// reachable by POST without any layout ever rendering (BUILD_SPEC 4).

import { nanoid } from 'nanoid'

import { isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { ownedEmbed } from '@/features/cms/authorize'
import { parseEmbedFormat, parseEmbedSave } from '@/features/cms/save-payload'
import { createCmsEmbed, deleteCmsEmbed, updateCmsEmbed } from '@/services/airtable/mutations-cms'
import type { CmsEmbedEdit } from '@/services/airtable/to-fields-cms'
import { EMBED_DEFAULTS, type EmbedFormat } from '@/types/cms'

export type EmbedActionResult =
  | { ok: true; message: string; embedId: string }
  | { ok: false; message: string }

/** Ref 32's card title on a brand-new embed, verbatim. */
const NEW_EMBED_NAME = 'New Embed'
const NAME_LIMIT = 120

// `isEventOrganizer` is deliberately NOT re-exported from here. Every export of a `'use server'`
// module becomes a callable endpoint, and a render-decision helper is not something a browser
// should be able to invoke. Pages import it from ./authorize.

/**
 * "+ Add Embed". Creates one embed and hands back its id so the caller can open the editor.
 *
 * The format comes from the menu behind ref 32's dropdown caret, which is what that caret is
 * for: five formats, five entries. It is VALIDATED here rather than trusted, because this is a
 * Server Action and the argument arrives over the wire; an unrecognised value falls back to
 * `styled_html`, the transcribed default, rather than failing the create.
 *
 * A new embed arrives DISABLED. Not transcribed (ref 32's one embed is Enabled): the
 * alternative is that one click starts serving a feed at a URL nobody has looked at yet.
 */
export async function createEmbedAction(
  eventId: string,
  format: EmbedFormat = 'styled_html',
): Promise<EmbedActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const created = await createCmsEmbed({
      eventId,
      name: NEW_EMBED_NAME,
      // `nanoid(12)`, exactly as a Form's public id is minted: from a CSPRNG, so an embed URL
      // cannot be guessed from the event slug or walked from a neighbouring embed.
      publicId: nanoid(12),
      format: parseEmbedFormat(format) ?? 'styled_html',
      view: 'agenda',
      enabled: false,
      // The captured Style Options defaults, written out so the row an organizer opens in Airtable
      // shows what the editor shows. See `CmsEmbedDraft`.
      ...EMBED_DEFAULTS,
    })
    return { ok: true, message: 'Embed created.', embedId: created.id }
  } catch (error) {
    return failure(error)
  }
}

/**
 * The duplicate icon on ref 32's card.
 *
 * The copy gets a NEW `publicId` and arrives disabled. Both matter: sharing the original's id
 * would make two records serve one URL, and copying its enabled state would put a second live
 * feed on the internet from a single click on an icon with no confirmation.
 */
export async function duplicateEmbedAction(
  eventId: string,
  embedId: string,
): Promise<EmbedActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const source = await ownedEmbed(eventId, embedId)
    const created = await createCmsEmbed({
      eventId,
      name: truncate(`${source.name} copy`),
      publicId: nanoid(12),
      format: source.format,
      view: source.view,
      enabled: false,
      // A duplicate copies the ORIGINAL's styling, filters and field selection, because those are
      // what an organizer duplicated an embed to reuse. Only `publicId` and `enabled` are reset.
      colorTheme: source.colorTheme,
      primaryColor: source.primaryColor,
      dateTimeFormat: source.dateTimeFormat,
      // The comment above was a claim the code did not keep: filters, field options and the
      // custom CSS were all left behind, so a duplicate came back with an empty filter set (which
      // is the BROADEST one) and every optional field switched back on. The CSS is copied raw, so
      // the copy carries what the organizer typed rather than the sanitized rendering of it.
      // Found by Codex review.
      ...(source.extraCssRaw === undefined ? {} : { extraCss: source.extraCssRaw }),
      filters: source.filters,
      fieldOptions: source.fieldOptions,
    })
    return { ok: true, message: 'Embed duplicated.', embedId: created.id }
  } catch (error) {
    return failure(error)
  }
}

/**
 * The whole editor, in ONE write: Type, Style Options, Filters and Field Options.
 *
 * One write and not one per section, for the reason `updateCmsEmbed` states about the Type
 * section's three fields, only more so now. A per-section write would let a filter change land
 * while the style change submitted beside it failed, and the organizer would be looking at four
 * panels that agree with neither the base nor each other. `cmsEmbedEditFields` sends every column
 * on every save for the same reason.
 *
 * The parsing and every fallback live in ./save-payload, which is tested: this function is an
 * authorize, load, validate, write, and nothing else.
 */
export async function saveEmbedAction(
  eventId: string,
  embedId: string,
  formData: FormData,
): Promise<EmbedActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const existing = await ownedEmbed(eventId, embedId)

    const parsed = parseEmbedSave(formData, existing)
    if (!parsed.ok) return { ok: false, message: parsed.message }

    await updateCmsEmbed({
      embedId: existing.id,
      eventId,
      publicId: existing.publicId,
      edit: parsed.edit,
    })
    return { ok: true, message: 'Your changes have been saved.', embedId: existing.id }
  } catch (error) {
    return failure(error)
  }
}

/**
 * The Enabled toggle and the overflow menu's Enable/Disable, without touching the name.
 *
 * A status-only write, deliberately separate from the save above: the list page has no name in
 * hand, and sending whatever it happened to be holding would revert an edit made in the editor
 * in between.
 */
export async function setEmbedEnabledAction(
  eventId: string,
  embedId: string,
  enabled: boolean,
): Promise<EmbedActionResult> {
  return await patch(eventId, embedId, (existing) => ({ ...unchanged(existing), enabled }))
}

/**
 * Delete one embed.
 *
 * The URL stops resolving, which is the point and also the risk: it may be in somebody's live
 * HTML. The confirmation is the caller's (an `AlertDialog`), because only the UI knows whether
 * the organizer has been told.
 */
export async function deleteEmbedAction(
  eventId: string,
  embedId: string,
): Promise<EmbedActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const existing = await ownedEmbed(eventId, embedId)
    await deleteCmsEmbed({ embedId: existing.id, eventId, publicId: existing.publicId })
    return { ok: true, message: 'Embed deleted.', embedId: existing.id }
  } catch (error) {
    return failure(error)
  }
}

type Existing = Awaited<ReturnType<typeof ownedEmbed>>

/**
 * Every column a one-field write must send back unchanged. See `cmsEmbedEditFields`.
 *
 * It grew from three fields to nine when Style Options, Filters and Field Options got columns, and
 * that is exactly why it exists: an edit omits nothing, so a toggle from the list page has to carry
 * the whole row forward or it would clear an organizer's custom CSS by not mentioning it.
 */
function unchanged(existing: Existing): CmsEmbedEdit {
  return {
    name: existing.name,
    format: existing.format,
    view: existing.view,
    enabled: existing.enabled,
    colorTheme: existing.colorTheme,
    primaryColor: existing.primaryColor,
    dateTimeFormat: existing.dateTimeFormat,
    // The RAW value, not the sanitized one. `mapCmsEmbed` sanitizes on read, so carrying
    // `existing.extraCss` here rewrote the organizer's cell with the served text on every
    // unrelated toggle, and cleared it whenever nothing survived sanitizing. Found by Codex
    // review. Absent means "leave the column alone" now that `cmsEmbedEditFields` omits the key.
    ...(existing.extraCssRaw === undefined ? {} : { extraCss: existing.extraCssRaw }),
    filters: existing.filters,
    fieldOptions: existing.fieldOptions,
  }
}

/** The shared authorize-load-write path behind the two one-field writes. */
async function patch(
  eventId: string,
  embedId: string,
  edit: (existing: Existing) => CmsEmbedEdit,
): Promise<EmbedActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const existing = await ownedEmbed(eventId, embedId)
    await updateCmsEmbed({
      embedId: existing.id,
      eventId,
      publicId: existing.publicId,
      edit: edit(existing),
    })
    return { ok: true, message: 'Your changes have been saved.', embedId: existing.id }
  } catch (error) {
    return failure(error)
  }
}

/** A name longer than the column should hold is cut, not refused: it is a label. */
function truncate(value: string): string {
  return value.length <= NAME_LIMIT ? value : value.slice(0, NAME_LIMIT)
}

/**
 * An `AppError` carries a message written for a human, so it is shown. Anything else is a
 * genuine fault and is re-thrown, so it reaches the error boundary and the logs rather than
 * being reported to an organizer as if their input were at fault.
 */
function failure(error: unknown): EmbedActionResult {
  if (isAppError(error)) return { ok: false, message: error.message }
  throw error
}
