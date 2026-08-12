// The dry run: what the organizer is shown before anything is written.
//
// Two things are actually under test here. One is that the preview and the run AGREE:
// every row the preview counts is a row the run will write, and every row the run refuses
// is a number the preview already showed. The other is the CREATE/UPDATE SPLIT, which
// `previewCounts` cannot do on its own because nothing has consulted `IntegrationMappings`
// at that point, and which is the only thing that makes a re-import legible.
//
// It is also where the round-trip skip has to become visible. A pull from an Accelevents
// event bodo has been pushing into must name how many rows it will not bring back, rather
// than quietly returning a smaller number that looks like a partial event.

import { describe, expect, it } from 'vitest'

import { parseAcceleventsRef, parseSessionboardRef } from '@/features/imports/fetch-source'
import { previewImport } from '@/features/imports/preview'
import { runImport } from '@/features/imports/run'
import { EMPTY_IMPORT_MAPPING } from '@/types/imports'
import {
  acceleventsPayload,
  indexOf,
  NORMALIZED,
  newWorld,
  queuedRun,
  type World,
  worldDeps,
} from '../tests/helpers/imports-world'

function previewDeps(world: World, overrides: Partial<Parameters<typeof previewImport>[1]> = {}) {
  return {
    loadRemoteIndex: () => Promise.resolve(indexOf(world)),
    fetch: worldDeps(world).fetch,
    ...overrides,
  }
}

const SESSIONIZE = {
  eventId: 'recEvent',
  source: 'sessionize' as const,
  sourceRef: 'endpoint',
  mapping: EMPTY_IMPORT_MAPPING,
}

describe('previewImport', () => {
  it('reports everything as a create against an event with no mappings', async () => {
    const world = newWorld()

    const preview = await previewImport(SESSIONIZE, previewDeps(world))

    expect(preview.counts.room).toEqual({ created: 1, updated: 0, skipped: 0 })
    expect(preview.counts.speaker).toEqual({ created: 2, updated: 0, skipped: 0 })
    // The service session, which the run will not write either. The preview and the run
    // have to name the same number or the finished run reads as data loss.
    expect(preview.counts.submission).toEqual({ created: 1, updated: 0, skipped: 1 })
    expect(preview.counts.participant).toEqual({ created: 2, updated: 0, skipped: 0 })
  })

  it('counts the speakers who will land with no address', async () => {
    const world = newWorld()

    const preview = await previewImport(SESSIONIZE, previewDeps(world))

    // A count here rather than the rows, because the organizer is deciding whether to
    // proceed; the list itself is only useful once the speakers exist and can be edited.
    expect(preview.needsEmailCount).toBe(1)
  })

  it('moves rows into updated once a run has mapped them', async () => {
    const world = newWorld()
    await runImport(queuedRun(world).id, worldDeps(world))

    const preview = await previewImport(SESSIONIZE, previewDeps(world))

    expect(preview.counts.room).toEqual({ created: 0, updated: 1, skipped: 0 })
    expect(preview.counts.track).toEqual({ created: 0, updated: 1, skipped: 0 })
    expect(preview.counts.speaker).toEqual({ created: 0, updated: 2, skipped: 0 })
    expect(preview.counts.submission).toEqual({ created: 0, updated: 1, skipped: 1 })
  })

  it('names the rows bodo authored on the far side rather than subtracting them', async () => {
    const world = newWorld()
    world.mappings.push({
      eventId: 'recEvent',
      entityType: 'submission',
      localId: 'recSubOld',
      remoteId: 'accelevents:x1',
      // A real payload hash, so this row is one the PUSH created at Accelevents.
      requestHash: 'sha-of-the-payload',
      syncedAt: '2026-08-01T00:00:00.000Z',
    })

    const preview = await previewImport(
      { ...SESSIONIZE, source: 'accelevents', sourceRef: '99:my-event' },
      previewDeps(world, {
        fetch: worldDeps(world, { normalized: acceleventsPayload() }).fetch,
      }),
    )

    expect(preview.counts.submission).toEqual({ created: 0, updated: 0, skipped: 1 })
    expect(preview.warnings).toEqual([
      "1 records were created by bodo's own sync and will not be imported back.",
    ])
  })

  it('keeps the mapper warnings, and adds none when nothing was skipped', async () => {
    const world = newWorld()

    const preview = await previewImport(
      SESSIONIZE,
      previewDeps(world, {
        fetch: worldDeps(world, {
          normalized: { ...NORMALIZED, warnings: ['Two roles were not recognised: host.'] },
        }).fetch,
      }),
    )

    expect(preview.warnings).toEqual(['Two roles were not recognised: host.'])
  })

  it('turns a source with categories into one row per category', async () => {
    const world = newWorld()

    const preview = await previewImport(
      SESSIONIZE,
      previewDeps(world, {
        fetch: () =>
          Promise.resolve({
            normalized: NORMALIZED,
            categories: [
              { id: '1', title: 'Track', type: 'session' as const, items: [{}, {}] },
              { id: '2', title: 'Session format', type: 'session' as const, items: [{}] },
            ],
          }),
      }),
    )

    // Guessed from the title and never assumed: the organizer confirms each one before
    // any of it is applied.
    expect(preview.categories).toEqual([
      { id: '1', title: 'Track', itemCount: 2, suggested: 'track' },
      { id: '2', title: 'Session format', itemCount: 1, suggested: 'format' },
    ])
  })

  it('carries no categories for the two typed sources', async () => {
    const world = newWorld()

    const preview = await previewImport(SESSIONIZE, previewDeps(world))

    expect(preview.categories).toEqual([])
  })
})

describe('sourceRef parsing', () => {
  it('splits a Sessionboard ref into a region and an event id', () => {
    expect(parseSessionboardRef('eu:1234')).toEqual({ region: 'eu', eventId: '1234' })
  })

  it('refuses a Sessionboard ref with no region, before the token is spent', () => {
    // An EU token presented to the US host answers 401, which is unreadable from the run
    // row, so a missing region has to fail here instead.
    expect(() => parseSessionboardRef('1234')).toThrow()
    expect(() => parseSessionboardRef('uk:1234')).toThrow()
  })

  it('accepts an Accelevents ref with or without the event id', () => {
    expect(parseAcceleventsRef('99:my-event')).toEqual({ eventId: '99', eventUrl: 'my-event' })
    // §5.7 records the url on every synced event and the id only sometimes. Without the
    // id the admin reads cannot be addressed, and the run says so rather than failing.
    expect(parseAcceleventsRef('my-event')).toEqual({ eventUrl: 'my-event' })
  })
})
