// Migration 001: the whole base, as declared by BUILD_SPEC section 3.
//
// One migration split across four declaration files only because the 300-line
// limit forbids one file with 29 tables in it. Applied by scripts/airtable-schema.ts.
//
// Per src/migrations/README.md this file is not edited once it has been applied to
// a base somebody else has: a new column is migration 002, so that a base built
// from this directory in order matches a base built from it a month ago.
//
// WHERE SECTION 3 IS AMBIGUOUS, and what was chosen instead of guessing silently:
//
//   - `Events` start and end dates are declared `dateTime`, not `date`. Section 3
//     says "dates (start/end date)", but MonthView.tsx and timeline-model.ts
//     resolve the event's first day through `dateKeyAt(startsAt, timezone)`, and a
//     date-only value arrives as UTC midnight, which is the previous day for every
//     timezone west of UTC. The fixtures already store a full instant.
//   - `Events.accelEventId` is created even though section 3's Events list does not
//     mention it, because mapping.ts:71 reads it. A column the DAL reads and the
//     base lacks is a value that is silently always undefined.
//   - `Speakers.linksJson` and not `links`. Section 3 says `links`, the DAL reads
//     `linksJson` first and the note on COL.linksJson asks the migration to settle
//     it. Settled here.
//   - Section 3 gives no choice lists for `Submissions.format`, `level`,
//     `language`, `Speakers.pronouns`, `Speakers.gender`, or `Events.eventType`.
//     The lists in tables-core.ts are a starting vocabulary an organizer will
//     extend in Airtable, and no mapper validates them (each is read through
//     `optionalText`). A SEEDED value must be in the list, because Airtable rejects
//     a write of an unknown single-select option.
//   - `ApiTokens` from section 3 IS created now, in tables-api.ts. It used to be
//     absent because TABLES in src/services/airtable/tables.ts carried no entry
//     for it and this file may not spell a table the registry does not; R10 added
//     both in one change, which is the only way that stays true.
//   - Every link is created as `multipleRecordLinks` with no
//     `prefersSingleRecordLink`, including the ones section 3 uses as a single
//     link. The DAL collapses a single link to a scalar id in `optionalLink`
//     either way, so the flag is cosmetic in the Airtable UI, and it is left off
//     rather than sent unverified against a live base.

import type { TableSpec } from '@/migrations/schema-types'
import { API_TABLES } from '@/migrations/tables-api'
import { CMS_TABLES } from '@/migrations/tables-cms'
import { COMMS_TABLES } from '@/migrations/tables-comms'
import { CORE_TABLES } from '@/migrations/tables-core'
import { CRM_TABLES } from '@/migrations/tables-crm'
import { PORTAL_TABLES } from '@/migrations/tables-portal'
import { REVIEW_TABLES } from '@/migrations/tables-review'
import { WEBHOOK_TABLES } from '@/migrations/tables-webhooks'

/**
 * Declaration order does NOT determine creation order, and that is deliberate.
 * `Submissions` links to `Tracks`, which is declared after it, and `PortalItems`
 * links to four tables at once, so any single ordering of a graph this shaped would
 * be wrong somewhere. `planSchema` in diff.ts creates every table with its scalar
 * columns first and adds every link field afterwards, which needs no ordering at
 * all. The order here is only how a reader wants to read it.
 */
export const MIGRATION_001: readonly TableSpec[] = [
  ...CORE_TABLES,
  ...REVIEW_TABLES,
  ...PORTAL_TABLES,
  ...COMMS_TABLES,
  ...CMS_TABLES,
  ...CRM_TABLES,
  ...API_TABLES,
  ...WEBHOOK_TABLES,
]
