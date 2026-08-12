// Mapper for SavedViews. BUILD_SPEC section 3.
//
// Three of the eight columns are JSON blobs, so this is mostly a Zod boundary: the stored
// text is parsed and validated against the shape the DataTable expects before anything
// outside this directory sees it. `jsonBlob` throws `DATA_SHAPE_INVALID` naming the record
// on a blob that does not match, which is the same posture the rest of the DAL takes and
// is deliberate here too. A saved view is written by one code path only, so a blob that
// fails validation means the schema and the writer have diverged, and silently handing
// back an empty column list would look like a view that lost its columns.
//
// A filter's `id` is NOT stored. It is positional, exactly as it is in the URL form
// (`abstracts-query.ts`), so it is assigned on read and renumbered again on apply.
// Storing it would persist a value that means nothing outside one render pass.

import { z } from 'zod'

import { FILTER_OPERATORS } from '@/components/primitives/data-table-types'
import {
  type AirtableRecord,
  checkbox,
  jsonBlob,
  optionalLink,
  requiredChoice,
  requiredLink,
  text,
  view,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { SAVED_VIEW_SURFACES, type SavedView } from '@/types/saved-views'

const columnsSchema = z.array(z.string().min(1))

const sortSchema = z
  .object({ key: z.string().min(1), direction: z.enum(['asc', 'desc']) })
  .nullable()

const filtersSchema = z.array(
  z.object({
    key: z.string().min(1),
    operator: z.enum([...FILTER_OPERATORS]),
    // Empty for `is_empty` and `is_not_empty`, which take no operand.
    value: z.string(),
  }),
)

/** The shape written to `filterJson`: a filter without its positional id. */
export type StoredFilter = z.infer<typeof filtersSchema>[number]

export function mapSavedView(record: AirtableRecord): SavedView {
  const source = view(TABLES.savedViews, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    // Required: the name IS the entry in the dropdown, so a blank one is a row nobody
    // could ever pick out of the menu.
    name: text(source, COL.name),
    // No default. The surface decides which list a view belongs to, so reading a blank
    // one as `abstracts` would put an agenda view in the Abstracts menu.
    surface: requiredChoice(source, COL.surface, SAVED_VIEW_SURFACES),
    ownerId: optionalLink(source, COL.owner),
    // A blank blob is an empty set rather than an error: a row created in Airtable
    // directly has all three columns empty, and "no columns stored" is a legible view
    // (the surface falls back to its default column set) where a thrown error is not.
    columnKeys: jsonBlob(source, COL.columnsJson, columnsSchema, []),
    sort: jsonBlob(source, COL.sortJson, sortSchema, null),
    filters: jsonBlob(source, COL.filterJson, filtersSchema, []).map((filter, index) => ({
      ...filter,
      id: `v${index}`,
    })),
    // An unchecked Airtable checkbox is absent, and absent means not the default.
    isDefault: checkbox(source, COL.isDefault),
  }
}
