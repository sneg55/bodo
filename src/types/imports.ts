// One inbound import run, and the vocabularies its row is written from. BUILD_SPEC 5.0e.
//
// Direction is the whole design and it is worth restating where the types live: this is a
// PULL. Nothing here ever writes to the far side, there is no reconciliation loop, and a
// re-run updates what it created and creates what is new but never deletes. §5.7's
// outbound Accelevents push is a separate, frozen feature that happens to share a provider
// name; it shares no code with this.
//
// The row is also the resume point. A 500-session event does not fit in one Worker
// request, so the run is claimed through `claimOnce()` and advances a PHASE at a time,
// writing progress back as it goes. A CPU limit therefore ends a phase rather than the
// run, and a resumed run does not redo a finished one.

import type { RecordId } from '@/types/domain'

/**
 * The three sources, and there will not casually be a fourth.
 *
 * They do not divide by API shape, they divide by whether the source carries an EMAIL
 * ADDRESS. `sessionboard` and `accelevents` do, so their imports produce speakers who can
 * be sent a magic link the moment the run finishes. `sessionize` does not, by design on
 * their side, so its import ends on a Needs-email list. See `needsEmail` below.
 */
export const IMPORT_SOURCES = ['sessionboard', 'sessionize', 'accelevents'] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  sessionboard: 'Sessionboard',
  sessionize: 'Sessionize',
  accelevents: 'Accelevents',
}

export const IMPORT_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

/**
 * Dependency order, and the array order IS the order they run in.
 *
 * A submission cannot reference a track that does not exist yet, so metadata (rooms,
 * tracks, tags, formats, levels, languages) goes first, then speakers, then submissions,
 * then their agenda placement. This is §5.7's push order in reverse, which is not a
 * coincidence: both walks are constrained by the same link graph.
 */
export const IMPORT_PHASES = ['metadata', 'speakers', 'submissions', 'agenda'] as const
export type ImportPhase = (typeof IMPORT_PHASES)[number]

export const IMPORT_PHASE_LABELS: Record<ImportPhase, string> = {
  metadata: 'Tracks, tags and rooms',
  speakers: 'Speakers',
  submissions: 'Sessions',
  agenda: 'Agenda',
}

/** What the import can create, and the key `counts` is reported under. */
export const IMPORT_ENTITY_TYPES = [
  'room',
  'track',
  'tag',
  'speaker',
  'submission',
  'participant',
] as const
export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number]

/**
 * Created and updated per entity type.
 *
 * Two numbers rather than one, because the difference is the whole answer to "is this
 * re-run doing what I think": a second run of the same import should be almost all
 * updates, and a wall of creates means the idempotency key is not matching.
 *
 * `skipped` is the third and it is specific to Accelevents: that is the one source bodo
 * also pushes TO, so a pull from the same remote event would re-import bodo's own writes.
 * `IntegrationMappings` records every remote id bodo authored and those are skipped, which
 * has to be a visible number rather than a silent subtraction.
 */
export type ImportCount = {
  created: number
  updated: number
  skipped: number
}

export type ImportCounts = Partial<Record<ImportEntityType, ImportCount>>

export const EMPTY_IMPORT_COUNT: ImportCount = { created: 0, updated: 0, skipped: 0 }

/**
 * A speaker the run created with no address, so nobody can contact them yet.
 *
 * Sessionize's public speaker object has no email field at all, and inventing one is the
 * failure this type exists to prevent: a synthesised `first.last@example.com` looks like
 * data, passes every validation in this codebase, and silently produces a speaker whose
 * magic link goes nowhere. So the address is left empty, the speaker is still created
 * (dropping them loses the whole programme), and the run finishes owing the organizer this
 * list.
 */
export type NeedsEmailRow = {
  speakerId: RecordId
  name: string
  /** The remote id, so the organizer can find them on the far side. */
  remoteId: string
}

/**
 * One run.
 *
 * `sourceRef` is what identifies the far side, and it is per source: a Sessionize endpoint
 * id, a Sessionboard region plus source event id, or an Accelevents event url. It is NOT a
 * credential and never holds one.
 *
 * There is deliberately **no credential column**. A Sessionboard organization token is
 * read for the duration of the run and stored nowhere, so a re-run asks for it again. That
 * is a real ergonomic cost, taken knowingly: the alternative is a token sitting in an
 * Airtable base every collaborator on the event can open.
 *
 * `leaseHolder` and `leaseExpiresAt` record what `claimOnce()` decided; they do not
 * acquire anything. Airtable has no compare-and-swap, so two callers can both write these
 * columns and both believe they won. The ClaimGuard Durable Object is the lock.
 */
export type ImportRun = {
  id: RecordId
  eventId: RecordId
  source: ImportSource
  sourceRef: string
  /** Sessionize's category-to-concept choices. Empty for the two typed sources. */
  mapping: ImportMapping
  status: ImportStatus
  phase: ImportPhase
  counts: ImportCounts
  needsEmail: readonly NeedsEmailRow[]
  leaseHolder?: string
  leaseExpiresAt?: string
  error?: string
  startedAt?: string
  finishedAt?: string
}

/**
 * Which bodo concept each Sessionize category feeds.
 *
 * Needed for exactly one source. Sessionize categories are USER-NAMED and untyped beyond
 * `session` / `speaker`: the demo event's happen to be `Session format`, `Track`, `Level`
 * and `Language`, and nothing guarantees any of that. Sessionboard and Accelevents both
 * type their taxonomies on their own side, so their runs carry an empty mapping.
 *
 * Keyed by the category id as a string, because the same document types ids two ways (see
 * the Zod boundary in the Sessionize client) and one key type here is the fix.
 */
export type ImportMapping = {
  categories: Readonly<Record<string, ImportCategoryTarget>>
}

export const IMPORT_CATEGORY_TARGETS = [
  'track',
  'tag',
  'format',
  'level',
  'language',
  'ignore',
] as const
export type ImportCategoryTarget = (typeof IMPORT_CATEGORY_TARGETS)[number]

export const IMPORT_CATEGORY_TARGET_LABELS: Record<ImportCategoryTarget, string> = {
  track: 'Track',
  tag: 'Tag',
  format: 'Format',
  level: 'Level',
  language: 'Language',
  ignore: 'Do not import',
}

export const EMPTY_IMPORT_MAPPING: ImportMapping = { categories: {} }

/**
 * What a dry run found, before anything is written.
 *
 * Every run previews first, and the preview is not an extra cost: it is exactly the reads
 * the real run starts with. `needsEmail` is a count here rather than the rows, because the
 * organizer is deciding whether to proceed and the list itself is only useful once the
 * speakers exist and can be edited.
 */
export type ImportPreview = {
  source: ImportSource
  sourceRef: string
  counts: ImportCounts
  needsEmailCount: number
  /** Categories the Sessionize step has to map, empty for the other two sources. */
  categories: readonly ImportCategoryPreview[]
  /** Anything the organizer should know before pressing Import. Never a silent skip. */
  warnings: readonly string[]
}

export type ImportCategoryPreview = {
  id: string
  title: string
  itemCount: number
  /** Guessed from the title, never assumed. The organizer confirms it. */
  suggested: ImportCategoryTarget
}
