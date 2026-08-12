// The Integrations page's model, which is the part of that surface a wrong answer is
// expensive in. Three things are pinned here and each one is a data-loss story, not a
// styling preference.
//
// DIRECTION. `Sync now` and `Import` are never the same button renamed, so the two labels
// are asserted to differ and the push control is asserted to exist on exactly one row. A
// misconfigured push writes wrong rows into somebody else's system; a misconfigured pull
// writes wrong rows into this event.
//
// CONFIGURATION. "Not configured" has to name what is missing, and a per-run credential is
// not a missing one: a Sessionboard token is read for the length of a run and stored
// nowhere, so its row says `Asked for each import` rather than sending an organizer to look
// for a settings field that does not exist.
//
// THE REGISTRY IS THE PAGE. Every provider in `INTEGRATION_PROVIDERS` must produce a row
// with no per-provider branching, which is what makes a fourth provider a descriptor.

import { describe, expect, it } from 'vitest'

import { formatInstant, remoteEventHref } from '@/features/integrations/format'
import {
  countsText,
  IMPORT_UNAVAILABLE,
  importRunRow,
  MISSING_REMOTE_EVENT,
  providerActions,
  providerConnection,
  providerRow,
} from '@/features/integrations/model'
import {
  INTEGRATION_PROVIDERS,
  type IntegrationSettings,
  integrationProvider,
} from '@/services/integrations/registry'
import { EMPTY_IMPORT_MAPPING, type ImportRun } from '@/types/imports'

const ACCEL = integrationProvider('accelevents')
const SESSIONBOARD = integrationProvider('sessionboard')
const SESSIONIZE = integrationProvider('sessionize')

const ZONE = 'America/New_York'

const settings = (overrides: Partial<IntegrationSettings> = {}): IntegrationSettings => ({
  accelevents: { hasApiKey: false, mock: false },
  sessionboard: {},
  sessionize: {},
  ...overrides,
})

const run = (overrides: Partial<ImportRun> = {}): ImportRun => ({
  id: 'recRun1',
  eventId: 'recEvent1',
  source: 'sessionize',
  sourceRef: '14022',
  mapping: EMPTY_IMPORT_MAPPING,
  status: 'done',
  phase: 'agenda',
  counts: {},
  needsEmail: [],
  ...overrides,
})

describe('providerConnection', () => {
  it('treats the mock as a configuration, not a missing one', () => {
    const connection = providerConnection(
      ACCEL,
      settings({ accelevents: { hasApiKey: false, mock: true } }),
      {
        eventUrl: 'ai-engineer-2026',
      },
    )
    expect(connection).toEqual({ kind: 'connected', detail: 'ai-engineer-2026' })
  })

  it('names the credential AND the event mapping when both are absent', () => {
    const connection = providerConnection(ACCEL, settings(), {})
    expect(connection.kind).toBe('unconfigured')
    expect(connection.kind === 'unconfigured' ? connection.missing : []).toEqual([
      'ACCELEVENTS_API_KEY',
      MISSING_REMOTE_EVENT,
    ])
  })

  it('still refuses a configured deployment whose event was never mapped', () => {
    const connection = providerConnection(
      ACCEL,
      settings({ accelevents: { hasApiKey: true, mock: false } }),
      { eventId: 'only-the-id' },
    )
    expect(connection.kind === 'unconfigured' ? connection.missing : []).toEqual([
      MISSING_REMOTE_EVENT,
    ])
  })

  it('treats a blank event URL as absent rather than as a mapping', () => {
    const connection = providerConnection(
      ACCEL,
      settings({ accelevents: { hasApiKey: true, mock: false } }),
      { eventUrl: '   ' },
    )
    expect(connection.kind).toBe('unconfigured')
  })

  it('reports a per-run credential as asked-for rather than as missing', () => {
    for (const provider of [SESSIONBOARD, SESSIONIZE]) {
      expect(providerConnection(provider, settings())).toEqual({ kind: 'per-run' })
    }
  })
})

describe('providerActions', () => {
  it('gives the two directions two different controls on the one provider with both', () => {
    const connected = providerConnection(
      ACCEL,
      settings({ accelevents: { hasApiKey: true, mock: false } }),
      { eventUrl: 'ai-engineer-2026' },
    )
    const actions = providerActions(ACCEL, connected)

    expect(actions.map((action) => action.direction)).toEqual(['pull', 'push'])
    expect(actions.map((action) => action.label)).toEqual(['Import', 'Sync now'])
    // The whole point: two labels, never one word reused.
    expect(new Set(actions.map((action) => action.label)).size).toBe(2)
  })

  it('labels every pull Import and never Sync now', () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      for (const action of providerActions(provider, { kind: 'per-run' })) {
        if (action.direction !== 'pull') continue
        expect(action.label).toBe('Import')
      }
    }
  })

  it('disables Import with a reason while there is no wizard to send it to', () => {
    const [pull] = providerActions(SESSIONIZE, { kind: 'per-run' })
    expect(pull.enabled).toBe(false)
    expect(pull.blockedReason).toBe(IMPORT_UNAVAILABLE)
    expect(pull.href).toBe(undefined)
  })

  it('enables Import as a link the moment a wizard route is supplied', () => {
    const [pull] = providerActions(
      SESSIONIZE,
      { kind: 'per-run' },
      '/admin/recE/imports/sessionize',
    )
    expect(pull.enabled).toBe(true)
    expect(pull.href).toBe('/admin/recE/imports/sessionize')
    expect(pull.blockedReason).toBe(undefined)
  })

  it('refuses the push and says what is missing when the event is not connected', () => {
    const connection = providerConnection(ACCEL, settings(), {})
    const push = providerActions(ACCEL, connection).find((action) => action.direction === 'push')
    expect(push?.enabled).toBe(false)
    expect(push?.blockedReason).toContain('ACCELEVENTS_API_KEY')
    expect(push?.blockedReason).toContain(MISSING_REMOTE_EVENT)
  })

  it('carries the direction description so the two cannot be confused', () => {
    const actions = providerActions(ACCEL, { kind: 'per-run' })
    expect(actions.find((action) => action.direction === 'pull')?.description).toContain(
      'into this event',
    )
    expect(actions.find((action) => action.direction === 'push')?.description).toContain(
      'into the provider',
    )
  })
})

describe('providerRow', () => {
  it('produces a row for every registered provider, with no per-provider branch', () => {
    const rows = INTEGRATION_PROVIDERS.map((provider) =>
      providerRow(provider, settings(), { runs: [], timeZone: ZONE }),
    )
    expect(rows.map((row) => row.id)).toEqual(INTEGRATION_PROVIDERS.map((p) => p.id))
    for (const row of rows) expect(row.directions.length).toBeGreaterThan(0)
  })

  it('shows a provider only its own runs', () => {
    const runs = [
      run({ id: 'recA', source: 'sessionize' }),
      run({ id: 'recB', source: 'sessionboard' }),
      run({ id: 'recC', source: 'sessionize' }),
    ]
    const row = providerRow(SESSIONIZE, settings(), { runs, timeZone: ZONE })
    expect(row.runs.map((entry) => entry.id)).toEqual(['recA', 'recC'])
  })
})

describe('importRunRow', () => {
  it('says a queued run has not started rather than rendering an empty timestamp', () => {
    expect(importRunRow(run({ status: 'queued', phase: 'metadata' }), ZONE).whenText).toBe(
      'Not started yet',
    )
  })

  it('prefers the finish over the start, since that is what the row settled on', () => {
    const row = importRunRow(
      run({ startedAt: '2026-08-09T12:00:00.000Z', finishedAt: '2026-08-09T13:00:00.000Z' }),
      ZONE,
    )
    expect(row.whenText.startsWith('Finished')).toBe(true)
    expect(row.whenText).toContain('9:00')
  })

  it('carries the error of a failed run through untouched', () => {
    expect(importRunRow(run({ status: 'failed', error: 'HTTP 502' }), ZONE).error).toBe('HTTP 502')
  })
})

describe('countsText', () => {
  it('sums created, updated and skipped across every entity type', () => {
    expect(
      countsText({
        speaker: { created: 2, updated: 1, skipped: 0 },
        submission: { created: 3, updated: 0, skipped: 4 },
      }),
    ).toBe('5 created, 1 updated, 4 skipped')
  })

  it('says nothing was recorded rather than printing three zeroes', () => {
    expect(countsText({})).toBe('Nothing recorded')
    expect(countsText({ track: { created: 0, updated: 0, skipped: 0 } })).toBe('Nothing recorded')
  })
})

describe('remoteEventHref', () => {
  it('does not invent a page address for what is really a slug', () => {
    expect(remoteEventHref('ai-engineer-2026')).toBe(undefined)
    expect(remoteEventHref(undefined)).toBe(undefined)
    expect(remoteEventHref('   ')).toBe(undefined)
  })

  it('links an absolute URL an organizer pasted in', () => {
    expect(remoteEventHref('https://www.accelevents.com/e/demo')).toBe(
      'https://www.accelevents.com/e/demo',
    )
  })
})

describe('formatInstant', () => {
  it('renders in the event timezone, not the reader"s', () => {
    // 00:30 UTC is the previous evening in New York, and the date has to move with it.
    expect(formatInstant('2026-08-10T00:30:00.000Z', ZONE)).toContain('Aug 9')
    expect(formatInstant('2026-08-10T00:30:00.000Z', 'UTC')).toContain('Aug 10')
  })

  it('shows an unparseable stamp as stored instead of Invalid Date', () => {
    expect(formatInstant('not-a-date', ZONE)).toBe('not-a-date')
  })
})
