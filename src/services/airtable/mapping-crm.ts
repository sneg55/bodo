// Mappers for the cross-event CRM tables: SpeakerTags and SpeakerLists.
//
// `speakerListFilters` is the one function in this file that is deliberately
// defensive rather than throwing. Every other mapper in this directory throws on a
// shape it cannot read, because a bad row is a data problem somebody has to fix. A
// stored `DataTableFilter[]` is different: it was written by the app itself and can
// be hand-edited in Airtable directly, and a single malformed list must not take
// down the CRM directory page for every organizer, only degrade its own filter to
// "no filter". So this one function parses defensively with Zod and returns an
// empty array on any failure: invalid JSON, a non-array payload, or an entry whose
// operator is not one of `FILTER_OPERATORS`. `mapSpeakerTag` and `mapSpeakerList`
// keep the throwing convention for their own required columns.

import { z } from 'zod'

import { type DataTableFilter, FILTER_OPERATORS } from '@/components/primitives/data-table-types'
import {
  type AirtableRecord,
  checkbox,
  linkIds,
  optionalLink,
  optionalText,
  text,
  view,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import type { SpeakerList, SpeakerTag } from '@/types/domain'

const filterSchema = z.object({
  id: z.string(),
  key: z.string(),
  operator: z.enum(FILTER_OPERATORS),
  value: z.string(),
})

const filtersSchema = z.array(filterSchema)

/**
 * A stored `SpeakerLists.definitionJson` cell, parsed into the filter array the
 * DataTable primitive already knows how to run. Never throws: an unparseable string,
 * a payload that is not an array, or one entry with an operator outside
 * `FILTER_OPERATORS` all degrade to `[]` rather than take the read down.
 */
export function speakerListFilters(json: string): readonly DataTableFilter[] {
  let decoded: unknown
  try {
    decoded = JSON.parse(json)
  } catch {
    return []
  }
  const parsed = filtersSchema.safeParse(decoded)
  return parsed.success ? parsed.data : []
}

export function mapSpeakerTag(record: AirtableRecord): SpeakerTag {
  const source = view(TABLES.speakerTags, record)
  return {
    id: source.id,
    name: text(source, COL.name),
    // Same fallback as the event-scoped `Tags` table (mapping-lookups.ts): a blank
    // cell is a row created outside the app, not a reason to fail the whole list.
    color: optionalText(source, COL.color) ?? '#64748b',
  }
}

export function mapSpeakerList(record: AirtableRecord): SpeakerList {
  const source = view(TABLES.speakerLists, record)
  return {
    id: source.id,
    name: text(source, COL.name),
    ownerId: optionalLink(source, COL.owner),
    isShared: checkbox(source, COL.isShared),
    filters: speakerListFilters(optionalText(source, COL.definitionJson) ?? ''),
  }
}

/**
 * Which speakers carry one SpeakerTags row, off its `speakers` link. Not part of
 * `SpeakerTag` itself (the domain type is the label, not its membership), so this is
 * exported for the read that answers "which tags does this one speaker have"
 * (`listSpeakerTagIds` in reads-crm.ts) rather than folded into `mapSpeakerTag`.
 */
export function speakerTagSpeakerIds(record: AirtableRecord): readonly string[] {
  return linkIds(view(TABLES.speakerTags, record), COL.speakers)
}
