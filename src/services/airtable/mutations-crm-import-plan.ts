// Row types and per-row planning for the speaker CSV import, split out of
// mutations-crm-import.ts for the line limit. This half decides WHAT to write for one row;
// that file decides HOW (batch-then-fallback) and orchestrates the whole import.
//
// `SpeakerImportField`, `SpeakerImportRow` and `ImportRowOutcome` are declared here rather
// than imported, because the modules that will eventually own them (a future column-mapping
// module and a future import-commit module) do not exist yet on this branch: this write
// layer was built ahead of the import UI that feeds it. Each is shaped to match the CRM
// plan's own interfaces verbatim, so a later task can either import these from here or
// declare structurally identical ones without a mismatch either way.
//
// `winsEmailTie` used to be declared here and is now imported from `email-tie.ts`, which has
// no imports of its own. It moved because the import PREVIEW needs the same rule and reaches
// it from a `'use client'` component: while it lived beside `getClient`, importing it as a
// value put `client.ts` and everything under it in the browser's module graph. See that file.

import { type AirtableClient, getClient } from '@/services/airtable/client'
import { winsEmailTie } from '@/services/airtable/email-tie'
import {
  type AirtableRecord,
  type FieldSet,
  linkIds,
  optionalText,
  view,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { type SpeakerDraft, speakerFields } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'

/**
 * The columns a speaker import can map onto. Matches the plan's Task 11
 * (`src/features/crm/import/fields.ts`), which does not exist on this branch yet.
 */
export type SpeakerImportField =
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'company'
  | 'tagline'
  | 'phone'
  | 'bio'

/** One parsed, mapped CSV row. `rowNumber` is 1-based, carried through for the error report. */
export type SpeakerImportRow = { readonly rowNumber: number; readonly email: string } & Partial<
  Record<SpeakerImportField, string>
>

declare const dedupedBrand: unique symbol

/**
 * A batch whose within-batch duplicate emails have already been resolved, and the only thing
 * `upsertSpeakersBatch` will accept.
 *
 * The brand is load-bearing, not decoration. This file's write layer reads its
 * existing-speaker snapshot once and refreshes it only between 10-row chunks, so two rows
 * sharing an email inside one chunk both plan as a create and produce two speaker records.
 * Nothing about that is detectable per row, and a caller who forgets to deduplicate gets no
 * error and no failing test: the import quietly creates two people. Requiring a type no plain
 * array satisfies turns that omission into a compile error at the call site.
 *
 * `dedupeRows` in `src/features/crm/import/dedup.ts` is the only producer in `src/`; the write
 * layer's own tests reach it through a helper that verifies the property before asserting it
 * (`tests/helpers/deduped-batch.ts`).
 *
 * Declared HERE rather than in that feature for two reasons, and NOT because the Airtable
 * layer avoids feature imports - six files in this directory already have one, which is all of
 * them: `queries.ts`, `mapping-cms.ts`, `portal-port.ts`, `mutations-event.ts`,
 * `mutations-lookups.ts`, `to-fields-event.ts`. The reasons that do hold: the feature already
 * imports this module for `SpeakerImportRow`, so declaring the brand there and consuming it
 * here would close a cycle; and a brand on a row type belongs beside the row type, where
 * anyone reading one meets the other.
 */
export type DedupedSpeakerRows = readonly SpeakerImportRow[] & {
  readonly [dedupedBrand]: true
}

export type ImportRowOutcome =
  | {
      readonly rowNumber: number
      readonly status: 'created' | 'updated'
      readonly speakerId: string
    }
  | {
      readonly rowNumber: number
      readonly status: 'failed'
      readonly email: string
      readonly reason: string
    }

/**
 * `index` is the row's position in the CALLER's input array, not `row.rowNumber`. The two
 * usually agree, but nothing enforces that a caller's `rowNumber`s are unique (a bug
 * upstream of this function, or a hand-built test), and `index` is what
 * `mutations-crm-import.ts` keys its outcome map on so two rows sharing a `rowNumber` still
 * each get their own outcome instead of silently collapsing to one.
 *
 * `eventIds` on `create` and `update` is every event the written speaker will belong to
 * after this write: just `[eventId]` for a create, or the matched speaker's existing
 * `events` link merged with `eventId` for an update. The writer needs this to know every
 * `eventSpeakersTag` the write actually affects, not only the one the import was run
 * against - see the merge in `planRow` below.
 */
export type RowPlan =
  | {
      readonly kind: 'invalid'
      readonly index: number
      readonly row: SpeakerImportRow
      readonly reason: string
    }
  | {
      readonly kind: 'create'
      readonly index: number
      readonly row: SpeakerImportRow
      readonly fields: FieldSet
      readonly eventIds: readonly RecordId[]
    }
  | {
      readonly kind: 'update'
      readonly index: number
      readonly row: SpeakerImportRow
      readonly recordId: RecordId
      readonly fields: FieldSet
      readonly eventIds: readonly RecordId[]
    }

function draftFrom(row: SpeakerImportRow, email: string): SpeakerDraft {
  return {
    email,
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    tagline: row.tagline,
    phone: row.phone,
    bio: row.bio,
  }
}

/**
 * Decide what one row needs: nothing (invalid), a create, or an update merging this event
 * into whatever events the matched speaker already belongs to. `byEmail` is a snapshot the
 * caller built once and refreshes between chunks; see mutations-crm-import.ts for why a
 * repeat within one chunk still plans as two creates.
 */
export function planRow(
  index: number,
  row: SpeakerImportRow,
  eventId: RecordId,
  byEmail: ReadonlyMap<string, AirtableRecord>,
): RowPlan {
  const email = row.email.trim().toLowerCase()
  if (email === '' || !email.includes('@')) {
    return { kind: 'invalid', index, row, reason: email === '' ? 'Missing email' : 'Invalid email' }
  }

  const existing = byEmail.get(email)
  if (existing === undefined) {
    return {
      kind: 'create',
      index,
      row,
      fields: speakerFields({ ...draftFrom(row, email), eventIds: [eventId] }),
      eventIds: [eventId],
    }
  }

  const mergedEvents = [
    ...new Set([...linkIds(view(TABLES.speakers, existing), COL.events), eventId]),
  ]
  return {
    kind: 'update',
    index,
    row,
    recordId: existing.id,
    fields: speakerFields({ ...draftFrom(row, email), eventIds: mergedEvents }),
    eventIds: mergedEvents,
  }
}

/**
 * The same set the write will match against, as `{ id, email }` pairs the import PREVIEW can
 * ask `findDuplicates` about.
 *
 * It goes through `loadSpeakersByEmail` rather than reading the table itself, and that is the
 * whole point of it existing: the preview and the commit then resolve a shared email to the
 * same record by construction, including the `winsEmailTie` case, instead of by two callers
 * remembering to apply the same rule. The emails handed back are the NORMALIZED keys, which
 * `normalizeEmail` re-normalizes idempotently.
 *
 * Uncached, like the read underneath it. A cached snapshot would let the preview say "create"
 * for a speaker added a minute ago and then have the commit update them, which is exactly the
 * disagreement the preview exists to prevent.
 *
 * Lives here rather than in `reads-crm.ts` because it is a write-path read (queries.ts:19
 * draws that line) and because sharing a file with `loadSpeakersByEmail` is what keeps the two
 * from drifting. Features import it directly, as `listSavedViewsUncached` and
 * `readEventTeamUncached` are imported directly by their own actions.
 */
export async function listSpeakerIdentities(): Promise<
  readonly { readonly id: RecordId; readonly email: string }[]
> {
  const byEmail = await loadSpeakersByEmail(getClient())
  return [...byEmail].map(([email, record]) => ({ id: record.id, email }))
}

/** Every current speaker, keyed by normalized (trimmed, lowercased) email. Uncached. */
export async function loadSpeakersByEmail(
  client: AirtableClient,
): Promise<Map<string, AirtableRecord>> {
  const records = await client.listAll(TABLES.speakers)
  const byEmail = new Map<string, AirtableRecord>()
  for (const record of records) {
    const email = optionalText(view(TABLES.speakers, record), COL.email)
    if (email === undefined) continue
    const key = email.trim().toLowerCase()
    if (winsEmailTie(byEmail.get(key)?.id, record.id)) byEmail.set(key, record)
  }
  return byEmail
}
