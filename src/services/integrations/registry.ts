// The provider registry. `/admin/[eventId]/settings/integrations` renders THIS, and
// nothing about the layout knows the word "Accelevents". BUILD_SPEC §5.0d.
//
// **Every integration bodo builds from here is an import.** That is a decision taken
// 2026-08-09, and the Accelevents push is not a template for a second one: the brief
// asked for it (feature 7, "Native, one-way integration with Accelevents ... to eliminate
// manual data re-entry") and then withdrew it ("skip accelevents its fine, like i said
// its not required", hackathon-materials/discord/clarifications-2026-08-09.md, 21:10Z).
// So the push is frozen where it stands, a bonus that already ships and owes no further
// effort. Anyone adding a second push direction needs a citation of that kind, in this
// header, before the `directions` array below grows a `'push'`.
//
// **Direction is a set, not a value**, and the page must show it, because the two fail in
// opposite ways: a misconfigured push writes wrong rows into somebody else's system, a
// misconfigured pull writes wrong rows into this event. `Sync now` and `Import` are never
// the same button with a different label, and on the one provider that offers both they
// are two controls that never share a confirmation dialog. That is why the labels below
// are per direction rather than per provider.
//
// This module is a DESCRIPTOR. It performs no IO: `configured` is a predicate over a
// settings snapshot the caller builds, which is what makes every entry testable without
// an env, a token or a network. `integrationSettings()` is the single exception and the
// single place env is consulted, through `@/utils/env` and never `process.env`.
//
// A fourth provider is an entry in this array. Three hand-written cards drift the way
// three hand-written tables did before `DataTable` existed.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { IMPORT_SOURCES, type ImportSource } from '@/types/imports'
import { getEnv } from '@/utils/env'

export const INTEGRATION_DIRECTIONS = ['pull', 'push'] as const
export type IntegrationDirection = (typeof INTEGRATION_DIRECTIONS)[number]

/** The control each direction gets. Never interchangeable: see the header. */
export const DIRECTION_LABELS: Record<IntegrationDirection, string> = {
  pull: 'Import',
  push: 'Sync now',
}

/** What the organizer is told the direction does, in the direction's own words. */
export const DIRECTION_DESCRIPTIONS: Record<IntegrationDirection, string> = {
  pull: 'Reads from the provider and writes into this event.',
  push: 'Reads this event and writes into the provider.',
}

/**
 * What a provider row can offer beyond its direction.
 *
 * Vendor-named where the vendor named it (`continuousSync` is Sessionboard's own label
 * for "create/update records on a regular interval"), bodo-named where the surface is
 * ours (`syncLog` has no counterpart in their docs, which route a sync failure to
 * support with a screenshot).
 */
export const INTEGRATION_CAPABILITIES = [
  'continuousSync',
  'participantRoles',
  'syncLog',
  'mappings',
  'importWizard',
  'importPreview',
  'categoryMapping',
  'needsEmail',
  'roundTripGuard',
] as const
export type IntegrationCapability = (typeof INTEGRATION_CAPABILITIES)[number]

/**
 * Where a provider's credential lives, which is also how honest its `configured` answer
 * can be.
 *
 * `env` is checkable: the key is either deployed or it is not. `perRun` is not, and that
 * is by design rather than an omission. A Sessionboard organization token is read for the
 * length of one run and stored nowhere (`ImportRun` has deliberately no credential
 * column), so "configured" for those providers means "this run was given what it needs",
 * and the page says `Asked for each import` rather than `Not configured`.
 */
export const CREDENTIAL_SCOPES = ['env', 'perRun'] as const
export type CredentialScope = (typeof CREDENTIAL_SCOPES)[number]

/** Accelevents' half of the snapshot: env-derived, so the page never reads env itself. */
export type AcceleventsSettings = { hasApiKey: boolean; mock: boolean }

export type IntegrationSettings = {
  accelevents: AcceleventsSettings
  /** Pasted into the wizard, never stored. Absent outside a run. */
  sessionboard: { token?: string }
  /** The endpoint id on the ImportRun's `sourceRef`. */
  sessionize: { endpointId?: string }
}

/** `missing` names what to go and set, because "not configured" alone is not actionable. */
export type ConfiguredState = { configured: boolean; missing: readonly string[] }

export type IntegrationProvider = {
  id: ImportSource
  label: string
  directions: readonly IntegrationDirection[]
  credentialScope: CredentialScope
  capabilities: readonly IntegrationCapability[]
  /**
   * The namespace this provider's `IntegrationMappings.remoteId` values carry.
   *
   * Equal to `id`, and typed as `ImportSource` so it cannot drift from it. One table
   * holds every provider's remote ids, so without the prefix two providers collide on
   * the same integer and a pulled id can be pushed. See
   * src/services/accelevents/remote-id.ts.
   */
  remoteIdPrefix: ImportSource
  configured: (settings: IntegrationSettings) => ConfiguredState
}

const ACCELEVENTS: IntegrationProvider = {
  id: 'accelevents',
  label: 'Accelevents',
  // Both, and the only entry that will carry `push`. Read the header before adding one.
  directions: ['pull', 'push'],
  credentialScope: 'env',
  capabilities: [
    'continuousSync',
    'participantRoles',
    'syncLog',
    'mappings',
    'importWizard',
    'importPreview',
    'roundTripGuard',
  ],
  remoteIdPrefix: 'accelevents',
  configured: ({ accelevents }) => {
    // The mock IS a configuration, not a missing one: with ACCELEVENTS_MOCK=1 every call
    // is served in-repo and the whole flow runs, which is what makes the demo path real.
    // The env schema already refuses the other combination (no key with the flag off), so
    // this predicate never has to describe an impossible state.
    if (accelevents.mock || accelevents.hasApiKey) return CONFIGURED
    return { configured: false, missing: ['ACCELEVENTS_API_KEY'] }
  },
}

const SESSIONBOARD: IntegrationProvider = {
  id: 'sessionboard',
  label: 'Sessionboard',
  directions: ['pull'],
  credentialScope: 'perRun',
  capabilities: ['importWizard', 'importPreview', 'mappings'],
  remoteIdPrefix: 'sessionboard',
  configured: ({ sessionboard }) =>
    sessionboard.token === undefined || sessionboard.token === ''
      ? { configured: false, missing: ['Organization token'] }
      : CONFIGURED,
}

const SESSIONIZE: IntegrationProvider = {
  id: 'sessionize',
  label: 'Sessionize',
  directions: ['pull'],
  credentialScope: 'perRun',
  // No credential at all: a Sessionize endpoint is public. `categoryMapping` and
  // `needsEmail` are both consequences of that public shape (user-named categories, and
  // no email field on their speaker object), not options an organizer turns on.
  capabilities: ['importWizard', 'importPreview', 'categoryMapping', 'needsEmail', 'mappings'],
  remoteIdPrefix: 'sessionize',
  configured: ({ sessionize }) =>
    sessionize.endpointId === undefined || sessionize.endpointId === ''
      ? { configured: false, missing: ['Endpoint id'] }
      : CONFIGURED,
}

const CONFIGURED: ConfiguredState = { configured: true, missing: [] }

/**
 * Every provider, in the order the page lists them.
 *
 * Accelevents first because it is the only one an event can be connected to standing
 * still; the two importers are things an organizer does once, at the start.
 */
export const INTEGRATION_PROVIDERS: readonly IntegrationProvider[] = [
  ACCELEVENTS,
  SESSIONBOARD,
  SESSIONIZE,
]

export function integrationProvider(id: ImportSource): IntegrationProvider {
  const found = INTEGRATION_PROVIDERS.find((provider) => provider.id === id)
  // Not a soft `undefined`: `ImportSource` is a closed union, so a miss here means the
  // array and the vocabulary have diverged. That is a configuration fault in this file,
  // caught by the coverage test, and a caller has nothing useful to do with it.
  if (found === undefined) {
    throw new AppError(ErrorIds.CFG_MISSING, 'no integration provider is registered', { id })
  }
  return found
}

export function supportsDirection(
  provider: IntegrationProvider,
  direction: IntegrationDirection,
): boolean {
  return provider.directions.includes(direction)
}

export function hasCapability(
  provider: IntegrationProvider,
  capability: IntegrationCapability,
): boolean {
  return provider.capabilities.includes(capability)
}

/** Registered providers cover the whole source vocabulary. Asserted in the tests. */
export const REGISTERED_SOURCES: readonly ImportSource[] = IMPORT_SOURCES

/**
 * The snapshot the predicates read, and the ONLY function here that consults anything
 * outside its arguments.
 *
 * The env half goes through `getEnv()` because that is the one place `process.env` is
 * read in this codebase (a raw read is an ESLint error). The per-event half is passed in,
 * since neither importer's credential is deployment configuration: one is pasted into the
 * wizard and never stored, the other lives on an ImportRun.
 */
export function integrationSettings(
  scoped: { sessionboardToken?: string; sessionizeEndpointId?: string } = {},
): IntegrationSettings {
  const env = getEnv()
  return {
    accelevents: {
      hasApiKey: env.ACCELEVENTS_API_KEY !== undefined,
      mock: env.ACCELEVENTS_MOCK,
    },
    sessionboard: { token: scoped.sessionboardToken },
    sessionize: { endpointId: scoped.sessionizeEndpointId },
  }
}
