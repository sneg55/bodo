// The import wizard as data: which steps a source has, and when each one is satisfied.
//
// Pure, and split from the components for the reason `step-wizard.ts` is split from
// `StepWizard.tsx`: the arithmetic here decides whether an organizer may leave a step, and
// getting it wrong either traps them on a step they have finished or walks them onto
// `Import` with a half-built request. That is expensive to debug through a wizard and cheap
// to test directly.
//
// THE `source` STEP IS ABSENT, and that is not an omission. BUILD_SPEC 5.0e lists it first
// and then says it is "skipped when entered from a provider row, since the row names it".
// Every way into this wizard is a provider row: the route is
// `/settings/integrations/import/[source]`, so the source is a path segment resolved before
// the first render. A step whose only question is already answered by the URL is a step
// nobody reaches with anything to do, so it is not built.
//
// THE STEPS DIFFER BY SOURCE, and exactly one difference is real: `mapping` belongs to
// Sessionize alone. Its categories are user-named and untyped beyond `session`/`speaker`
// (5.0e trap 4), so the organizer says which bodo concept each one feeds. Sessionboard and
// Accelevents type their taxonomies on their own side, and a mapping step for them would
// render a page that says "nothing to do here".

import { isMappingComplete } from '@/features/imports/categories'
import type { SessionboardRegion } from '@/services/imports/sessionboard'
import {
  IMPORT_PHASES,
  type ImportCategoryPreview,
  type ImportMapping,
  type ImportPhase,
  type ImportSource,
  type ImportStatus,
} from '@/types/imports'

export const IMPORT_WIZARD_STEPS = ['credentials', 'mapping', 'preview', 'run'] as const
export type ImportWizardStepId = (typeof IMPORT_WIZARD_STEPS)[number]

/**
 * Everything the organizer types, for every source, in one flat record.
 *
 * Flat rather than a discriminated union per source because this is React state on a
 * screen whose source never changes: the union would buy a narrowing nobody needs and cost
 * a re-initialisation every time the wizard re-derived which arm it was on. The per-source
 * reading of these fields lives in `sourceRefFor` and nowhere else.
 *
 * `token` IS A CREDENTIAL. It exists in this object, in the browser tab, and in the body
 * of the action that spends it. It is never written to a record, never put in a query
 * string, and never part of `sourceRef`: `ImportRun` deliberately has no credential column,
 * so a re-run asks for it again (BUILD_SPEC 5.0e, "Secrets").
 */
export type ImportCredentials = {
  /** Sessionize endpoint id, off the organizer's API / Embed page. Public, not a secret. */
  endpointId: string
  /** Sessionboard organization token. Read for one run, stored nowhere. */
  token: string
  /** Sessionboard region. An EU token against the US host answers 401, not "wrong region". */
  region: SessionboardRegion
  /** The Sessionboard event to pull from, chosen off `listEvents` once the token is in. */
  remoteEventId: string
  /** Accelevents `<eventId>:<eventUrl>`, read off the event record rather than typed. */
  acceleventsRef: string
}

export const EMPTY_IMPORT_CREDENTIALS: ImportCredentials = {
  endpointId: '',
  token: '',
  region: 'us',
  remoteEventId: '',
  acceleventsRef: '',
}

export type ImportStepModel = {
  id: ImportWizardStepId
  title: string
  subtitle: string
}

/**
 * The credentials step is one step with three different questions behind it.
 *
 * Titled per source rather than "Credentials" three times, because for Accelevents the
 * honest title is not "credentials" at all: there is nothing to enter, the key is deployed
 * and the remote event is already on the event record. A step named for a thing the
 * organizer is not being asked for reads as a form that failed to load.
 */
const CREDENTIAL_STEP = new Map<ImportSource, ImportStepModel>([
  [
    'sessionize',
    { id: 'credentials', title: 'Endpoint', subtitle: 'The id off your API / Embed page' },
  ],
  [
    'sessionboard',
    { id: 'credentials', title: 'Token and event', subtitle: 'Used for this run only' },
  ],
  [
    'accelevents',
    { id: 'credentials', title: 'Connection', subtitle: 'Already configured for this event' },
  ],
])

const MAPPING_STEP: ImportStepModel = {
  id: 'mapping',
  title: 'Categories',
  subtitle: 'Which concept each one feeds',
}

const PREVIEW_STEP: ImportStepModel = {
  id: 'preview',
  title: 'Preview',
  subtitle: 'Counts before anything is written',
}

const RUN_STEP: ImportStepModel = {
  id: 'run',
  title: 'Import',
  subtitle: 'Progress, then who needs an address',
}

/** True for the one source whose taxonomy arrives untyped. See the header. */
export function needsCategoryMapping(source: ImportSource): boolean {
  return source === 'sessionize'
}

export function importWizardSteps(source: ImportSource): readonly ImportStepModel[] {
  const credentials = CREDENTIAL_STEP.get(source) ?? {
    id: 'credentials' as const,
    title: 'Connection',
    subtitle: 'What this import reads from',
  }
  return needsCategoryMapping(source)
    ? [credentials, MAPPING_STEP, PREVIEW_STEP, RUN_STEP]
    : [credentials, PREVIEW_STEP, RUN_STEP]
}

/**
 * The far side's identity, in the shape `fetch-source.ts` parses back out.
 *
 * Undefined rather than an empty string when the organizer has not finished typing, so the
 * gate has one thing to test and the action has one thing to refuse. The token is NOT here
 * and must never be: `sourceRef` is written to an Airtable column that every collaborator
 * on the event can read.
 */
export function sourceRefFor(
  source: ImportSource,
  credentials: ImportCredentials,
): string | undefined {
  if (source === 'sessionize') {
    const endpointId = credentials.endpointId.trim()
    return endpointId === '' ? undefined : endpointId
  }
  if (source === 'sessionboard') {
    const eventId = credentials.remoteEventId.trim()
    return eventId === '' ? undefined : `${credentials.region}:${eventId}`
  }
  const ref = credentials.acceleventsRef.trim()
  return ref === '' ? undefined : ref
}

/**
 * Whether the credentials step may be left.
 *
 * The token is checked separately from `sourceRefFor` and that separation is the point: a
 * credential is not part of the far side's identity, so a Sessionboard run whose token were
 * only checked through the ref would advance to a preview that cannot authenticate, and the
 * organizer would read a 401 as "wrong event id".
 */
export function credentialsReady(source: ImportSource, credentials: ImportCredentials): boolean {
  if (sourceRefFor(source, credentials) === undefined) return false
  return source !== 'sessionboard' || credentials.token.trim() !== ''
}

export type ImportWizardState = {
  source: ImportSource
  credentials: ImportCredentials
  /** What the organizer has CONFIRMED. Never pre-filled from the suggestions. */
  mapping: ImportMapping
  /** The categories the dry run found, empty for the two typed sources. */
  categories: readonly ImportCategoryPreview[]
  /**
   * False until a dry run has said which categories exist.
   *
   * Tracked separately from `categories.length` because the two are indistinguishable
   * before the first fetch and mean opposite things: "no categories" satisfies the mapping
   * step vacuously, and "not asked yet" must not. Without it the step is briefly complete
   * while it is still loading, and Continue walks past a question the organizer never saw.
   */
  categoriesKnown: boolean
  /** True once an `ImportRuns` row exists, which is the moment writing became possible. */
  started: boolean
}

/**
 * Which steps currently pass their own validation. Fed straight to `StepWizard`'s gate.
 *
 * `preview` completes when the RUN EXISTS rather than when the counts arrive, and that is
 * "nothing is written until the organizer presses Import" expressed as navigation. Without
 * a run row the run step has nothing to report, and a wizard that let somebody walk onto a
 * progress screen for an import that was never started would be describing a run that does
 * not exist.
 *
 * `mapping` leans on `isMappingComplete`, which is vacuously true for an empty category
 * list. That is correct for the two typed sources and unreachable for them anyway, since
 * `importWizardSteps` does not give them the step, and it is why `categoriesKnown` gates it
 * as well.
 */
export function completedImportSteps(state: ImportWizardState): ReadonlySet<string> {
  const done = new Set<string>()
  if (credentialsReady(state.source, state.credentials)) done.add('credentials')
  if (state.categoriesKnown && isMappingComplete(state.mapping, state.categories)) {
    done.add('mapping')
  }
  if (state.started) done.add('preview')
  return done
}

/**
 * How far the run has got, as a percentage of the four phases.
 *
 * Counted off the phases this wizard has WATCHED finish rather than off the row's `phase`
 * column, because that column names the phase about to be worked on and a run resumed by
 * cron between two of our calls would make the bar jump backwards. `done` is pinned to 100
 * for the case a phase was finished by somebody else: the run is over either way, and a bar
 * stuck at 75% on a finished import reads as a hang.
 */
export function importProgressPercent(
  status: ImportStatus,
  phasesDone: readonly ImportPhase[],
): number {
  if (status === 'done') return 100
  const seen = new Set(phasesDone)
  return Math.round((seen.size / IMPORT_PHASES.length) * 100)
}

/**
 * What one attempt at advancing the run means, in a sentence an organizer can act on.
 *
 * `no-client` is the one that has to be specific rather than generic, because it is the
 * documented consequence of a design decision and not a fault: the cron sweep holds no
 * Sessionboard token (there is no credential column to read one from), so it reports
 * `no-client` and leaves the row `running` with a lapsed lease for a caller that does hold
 * one. If this wizard is the caller and it still sees `no-client`, the token went missing
 * between the form and the action, and re-entering it is the fix.
 */
export const IMPORT_ATTEMPT_MESSAGES: ReadonlyMap<string, string> = new Map([
  ['done', 'Import finished.'],
  ['advanced', 'Import is still running.'],
  ['failed', 'The import failed. Nothing further will be written.'],
  [
    'contended',
    'Another worker is already advancing this run. Its progress appears under the provider row.',
  ],
  [
    'fenced',
    'This run was taken over by another worker while it was going. Its progress appears under the provider row.',
  ],
  ['terminal', 'This run has already finished.'],
  [
    'no-client',
    'The Sessionboard token was not available to this request, so the run cannot go on. Start the import again and re-enter it.',
  ],
])

/** True while another call is worth making. Every other attempt is an end state. */
export function shouldKeepAdvancing(attempt: string): boolean {
  return attempt === 'advanced'
}
