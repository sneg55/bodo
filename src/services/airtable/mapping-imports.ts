// The ImportRuns mapper, and the Zod schemas for its three blob columns.
//
// The schemas live here rather than in schemas.ts because these three are read by one
// table and one mapper, and nothing else in the base has an opinion about them. Same
// rule that file states for itself applies: they mirror the types in `@/types/imports`
// and are deliberately not derived from them, so a drift between the stored shape and
// the app shape is a type error at the mapper rather than a row that reads as empty.
//
// This table is EmailOutbox's twin, and the resemblance is not stylistic: both are rows
// a job claims, works on, and writes an outcome back to. So the same three traps apply
// (a link is an array, a blank field is an absent key, a JSON blob is text until
// something validates it) plus the one mapping-portal.ts states: a default is only safe
// when being wrong about it is VISIBLE. Every default below is chosen on that test, and
// the direction each one takes is written down next to it, because the reasoning is the
// only thing that stops the next reader from "tidying" it the other way.
//
// One thing this file does NOT do is treat the lease columns as a lock. See
// to-fields-imports.ts, which says why where the write is built.

import { z } from 'zod'
import {
  type AirtableRecord,
  choiceOr,
  jsonBlob,
  optionalText,
  requiredChoice,
  requiredLink,
  text,
  view,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import {
  EMPTY_IMPORT_MAPPING,
  IMPORT_CATEGORY_TARGETS,
  IMPORT_PHASES,
  IMPORT_SOURCES,
  IMPORT_STATUSES,
  type ImportCounts,
  type ImportMapping,
  type ImportRun,
  type NeedsEmailRow,
} from '@/types/imports'

/**
 * `ImportRuns.mappingJson`: the Sessionize category-to-concept choices.
 *
 * Keyed by category id as a STRING, because Sessionize types the same identifier two
 * ways in one document (BUILD_SPEC 5.0e, trap 1) and one key type here is the fix. An
 * unrecognised target is rejected rather than dropped: a category silently losing its
 * target imports its items as nothing at all, which looks like the far side had no
 * tracks rather than like a bad blob.
 */
export const importMappingSchema: z.ZodType<ImportMapping> = z.object({
  categories: z.record(z.string(), z.enum(IMPORT_CATEGORY_TARGETS)).default({}),
})

const importCountSchema = z.object({
  created: z.number().int().min(0).default(0),
  updated: z.number().int().min(0).default(0),
  // Defaulted rather than required, because `skipped` is the newest of the three (it
  // counts the Accelevents round-trip guard's hits) and a run row written before it
  // existed must still render in the history list.
  skipped: z.number().int().min(0).default(0),
})

/**
 * `ImportRuns.counts`: created, updated and skipped per entity type.
 *
 * Every key optional, because a run reports a phase's entity types only once that phase
 * has run: a run halfway through `speakers` has no `submission` key, and requiring one
 * would make the mapper throw on exactly the rows the progress screen is watching.
 *
 * Spelled out rather than built from `IMPORT_ENTITY_TYPES`, per this file's header: the
 * schema mirrors the type, it is not derived from it, so adding an entity type is two
 * deliberate edits instead of one that silently starts accepting a key nothing reads.
 */
export const importCountsSchema: z.ZodType<ImportCounts> = z.object({
  room: importCountSchema.optional(),
  track: importCountSchema.optional(),
  tag: importCountSchema.optional(),
  speaker: importCountSchema.optional(),
  submission: importCountSchema.optional(),
  participant: importCountSchema.optional(),
})

/** `ImportRuns.needsEmailJson`: the speakers the run created with no address. */
export const needsEmailSchema: z.ZodType<readonly NeedsEmailRow[]> = z.array(
  z.object({
    speakerId: z.string().min(1),
    name: z.string(),
    remoteId: z.string(),
  }),
)

/**
 * One run row.
 *
 * The three blobs each get a fallback, and the three arguments for them are different
 * from each other, so they are written out one by one below rather than waved at
 * together. What they share is that `jsonBlob` THROWS on a blob that is present and does
 * not parse: the fallback only ever answers a column that is genuinely empty, so none of
 * these is a way for corruption to arrive quietly.
 */
export function mapImportRun(record: AirtableRecord): ImportRun {
  const source = view(TABLES.importRuns, record)

  return {
    id: source.id,
    // Required. A run with no event has nothing to import into, and every cache tag this
    // table is read under is derived from the event id.
    eventId: requiredLink(source, COL.event),
    // No default, and no safe one exists. `source` decides which API is called and how
    // `sourceRef` is interpreted, so reading a blank one as `sessionize` would point a
    // Sessionize fetch at a Sessionboard event id and finish "successfully" having
    // imported nothing. An unreadable row is better than a run against the wrong API.
    source: requiredChoice(source, COL.source, IMPORT_SOURCES),
    // Required for the same reason: this is the far side's identity, and a run with none
    // has nothing to fetch. Never a credential (BUILD_SPEC 5.0e).
    sourceRef: text(source, COL.sourceRef),
    // Empty is the NORMAL reading, not a degraded one: Sessionboard and Accelevents type
    // their taxonomies on their own side, so two of the three sources legitimately store
    // nothing here. For Sessionize an empty mapping means every category is unassigned,
    // which imports the programme with no tracks or tags rather than guessing at them,
    // and the wizard's mapping step is what fills it in.
    mapping: jsonBlob(source, COL.mappingJson, importMappingSchema, EMPTY_IMPORT_MAPPING),
    // `failed`, and the choice is between the four in the order they do damage.
    //
    // `done` is the one that must not be picked: it hides a run that never ran behind a
    // row claiming it finished, and nothing ever looks at it again. `queued` and
    // `running` are visible but not inert, because the sweep in reads-imports.ts acts on
    // exactly those two, so a row whose status nobody wrote would be handed to a job that
    // starts writing records. `failed` is the only value that is both visible (it renders
    // red in the provider's history, with `Import` available to run it again) and
    // terminal, so being wrong costs one manual re-run and no unattended writes.
    //
    // Nothing this DAL creates relies on it: `importRunFields` writes `queued` explicitly
    // for the reason `taskAssignmentFields` writes `pending` explicitly.
    status: choiceOr(source, COL.status, IMPORT_STATUSES, 'failed'),
    // The FIRST phase, because the phases are a dependency order and the two ways of
    // being wrong about it are not symmetric. Read a blank phase as `metadata` and a
    // resumed run redoes work that `IntegrationMappings` turns into updates rather than
    // duplicates: recoverable, and visible as a wall of updates in `counts`. Read it as
    // the last phase and the run skips speakers and submissions entirely, then finishes
    // claiming success with an empty event. Silent data loss beats redundant work here.
    phase: choiceOr(source, COL.phase, IMPORT_PHASES, 'metadata'),
    // `{}` is safe because a run that reports nothing is visibly incomplete: the history
    // row shows no created and no updated records, which is exactly what an organizer
    // escalates. There is no reading of an empty counts blob that flatters the run.
    counts: jsonBlob(source, COL.counts, importCountsSchema, {}),
    // `[]`, and this one is NOT obviously safe, so here is the argument.
    //
    // An empty list and "every speaker got an address" render identically, and the second
    // is the answer an organizer wants to hear, so the fallback flatters the run. Three
    // things make it the right direction anyway:
    //
    //   1. Blank is the CORRECT reading for most of a run's life. The column is written
    //      once, at finish (`importRunOutcomeFields`), so every queued and running row
    //      has an empty one. Throwing would make the history list unreadable while a run
    //      is in progress, which is precisely when it is being watched.
    //   2. Corruption is already loud. `jsonBlob` throws on a blob that is present and
    //      unparseable, so the only case reaching this fallback is a column with nothing
    //      in it at all.
    //   3. This column is a SNAPSHOT, not the source of truth. Who has no address is a
    //      fact about the Speakers rows, and the Needs-email screen derives it from them
    //      with this list as the run's record of what it created. So a lost blob costs
    //      the convenience of scoping the list to one run; it cannot make a speaker with
    //      no email look contactable.
    //
    // What makes 3 hold on the write side is that `importRunOutcomeFields` writes `[]`
    // explicitly when a run finished having checked and found nobody, so "checked, none"
    // and "never checked" are different cells rather than the same blank.
    needsEmail: jsonBlob(source, COL.needsEmailJson, needsEmailSchema, []),
    // Recorded by the claim, and absent on a row nobody holds. Reading these as a lock is
    // the misreading to-fields-imports.ts warns about at the write.
    leaseHolder: optionalText(source, COL.leaseHolder),
    leaseExpiresAt: optionalText(source, COL.leaseExpiresAt),
    error: optionalText(source, COL.error),
    // Absent means the run has not been claimed yet, which is a fact the sweep and the
    // history list both read. Defaulting either of these to "now" would make an unstarted
    // run look like one that finished instantly.
    startedAt: optionalText(source, COL.startedAt),
    finishedAt: optionalText(source, COL.finishedAt),
  }
}
