// The registry is what the Integrations page renders, so these pin the two properties a
// page cannot recover from getting wrong.
//
// First, DIRECTION. A misconfigured push writes wrong rows into somebody else's system; a
// misconfigured pull writes wrong rows into this event. So `push` is asserted to exist on
// exactly one provider, and the labels for the two directions are asserted to differ:
// `Sync now` and `Import` are never the same button renamed.
//
// Second, the NAMESPACE. One table holds every provider's remote ids, so each entry has to
// declare its own prefix and no two may share one.
//
// The configuration predicates are pure by construction, which is what these can call
// without an env, a token or a network. `integrationSettings()` is the one function that
// reads env, and it is exercised through an injected snapshot instead.

import { describe, expect, it } from 'vitest'

import {
  DIRECTION_LABELS,
  hasCapability,
  INTEGRATION_PROVIDERS,
  type IntegrationSettings,
  integrationProvider,
  supportsDirection,
} from '@/services/integrations/registry'
import { IMPORT_SOURCES } from '@/types/imports'

const settings = (overrides: Partial<IntegrationSettings> = {}): IntegrationSettings => ({
  accelevents: { hasApiKey: false, mock: false },
  sessionboard: {},
  sessionize: {},
  ...overrides,
})

describe('the provider registry', () => {
  it('covers the whole import-source vocabulary, once each', () => {
    expect(INTEGRATION_PROVIDERS.map((provider) => provider.id).sort()).toEqual(
      [...IMPORT_SOURCES].sort(),
    )
    for (const source of IMPORT_SOURCES) {
      expect(integrationProvider(source).id).toBe(source)
    }
  })

  it('namespaces every provider distinctly, which is what stops an id collision', () => {
    const prefixes = INTEGRATION_PROVIDERS.map((provider) => provider.remoteIdPrefix)
    expect(new Set(prefixes).size).toBe(INTEGRATION_PROVIDERS.length)
    // The prefix IS the id. remote-id.ts depends on that and so does `remoteKey`.
    for (const provider of INTEGRATION_PROVIDERS) {
      expect(provider.remoteIdPrefix).toBe(provider.id)
    }
  })
})

describe('direction', () => {
  it('gives every provider a pull, because every integration built from here is an import', () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      expect(supportsDirection(provider, 'pull')).toBe(true)
    }
  })

  it('gives push to Accelevents alone, and it is frozen there', () => {
    const pushers = INTEGRATION_PROVIDERS.filter((provider) => supportsDirection(provider, 'push'))
    expect(pushers.map((provider) => provider.id)).toEqual(['accelevents'])
  })

  it('labels the two directions differently, since they fail in opposite ways', () => {
    expect(DIRECTION_LABELS.pull).toBe('Import')
    expect(DIRECTION_LABELS.push).toBe('Sync now')
    expect(DIRECTION_LABELS.pull).not.toBe(DIRECTION_LABELS.push)
  })
})

describe('configured', () => {
  it('treats the mock as configured, because the whole flow runs against it', () => {
    const accelevents = integrationProvider('accelevents')

    expect(
      accelevents.configured(settings({ accelevents: { hasApiKey: false, mock: true } })),
    ).toEqual({ configured: true, missing: [] })
  })

  it('names the missing key when the integration is live and unkeyed', () => {
    const accelevents = integrationProvider('accelevents')

    const state = accelevents.configured(settings())

    expect(state.configured).toBe(false)
    expect(state.missing).toEqual(['ACCELEVENTS_API_KEY'])
  })

  it('accepts a live key', () => {
    const accelevents = integrationProvider('accelevents')

    expect(
      accelevents.configured(settings({ accelevents: { hasApiKey: true, mock: false } }))
        .configured,
    ).toBe(true)
  })

  it('asks Sessionboard for the token it never stores', () => {
    const sessionboard = integrationProvider('sessionboard')

    expect(sessionboard.configured(settings()).missing).toEqual(['Organization token'])
    expect(sessionboard.credentialScope).toBe('perRun')
    expect(sessionboard.configured(settings({ sessionboard: { token: 'tok_1' } })).configured).toBe(
      true,
    )
  })

  it('asks Sessionize for an endpoint id and nothing else', () => {
    const sessionize = integrationProvider('sessionize')

    expect(sessionize.configured(settings()).missing).toEqual(['Endpoint id'])
    expect(
      sessionize.configured(settings({ sessionize: { endpointId: '14022' } })).configured,
    ).toBe(true)
  })

  it('never treats an empty string as a credential', () => {
    expect(
      integrationProvider('sessionboard').configured(settings({ sessionboard: { token: '' } }))
        .configured,
    ).toBe(false)
    expect(
      integrationProvider('sessionize').configured(settings({ sessionize: { endpointId: '' } }))
        .configured,
    ).toBe(false)
  })
})

describe('capabilities', () => {
  it('gives the sync log and the continuous-sync toggle to the pushing provider only', () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      const pushes = supportsDirection(provider, 'push')
      expect(hasCapability(provider, 'syncLog')).toBe(pushes)
      expect(hasCapability(provider, 'continuousSync')).toBe(pushes)
    }
  })

  it('gives the wizard to every importer and the category step to Sessionize alone', () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      expect(hasCapability(provider, 'importWizard')).toBe(true)
    }
    const mappers = INTEGRATION_PROVIDERS.filter((provider) =>
      hasCapability(provider, 'categoryMapping'),
    )
    expect(mappers.map((provider) => provider.id)).toEqual(['sessionize'])
  })

  it('flags only the source whose speakers arrive without an address', () => {
    const needsEmail = INTEGRATION_PROVIDERS.filter((provider) =>
      hasCapability(provider, 'needsEmail'),
    )
    expect(needsEmail.map((provider) => provider.id)).toEqual(['sessionize'])
  })
})
