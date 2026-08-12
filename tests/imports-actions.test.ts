// Who may start and advance an import, and what each action refuses. BUILD_SPEC 5.0e.
//
// THE ASSERTION THAT MATTERS IS NOT "IT THROWS". It is that nothing was written, and that
// the capability was checked against the event the run row names rather than against the
// event id the caller sent. `advanceImportAction` takes both, and nothing in the type
// system ties them together: `runImport` reads the event off the run and writes THAT one,
// so a check against the caller's claim would let an admin of one event drive an import
// that writes every table on another. An import writes rooms, tracks, tags, speakers,
// submissions and the agenda, so there is no smaller version of that mistake.
//
// The actions are `'use server'` and reach Airtable, a Durable Object and three remote
// APIs, so every boundary is mocked and the subject of each test is the guard rather than
// the work. Mocked at the module the action imports, not deeper, so a future refactor that
// dropped a guard would fail here instead of passing on a mock that no longer applies.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { EMPTY_IMPORT_MAPPING, type ImportRun } from '@/types/imports'

const EVENT_A = 'recEventA'
const EVENT_B = 'recEventB'
const RUN_IN_B = 'recRunInB'

const mocks = vi.hoisted(() => ({
  requireEventRole: vi.fn(),
  getImportRun: vi.fn(),
  createImportRun: vi.fn(),
  runImport: vi.fn(),
  previewImport: vi.fn(),
  importRunDeps: vi.fn(() => ({})),
  importPreviewDeps: vi.fn(() => ({})),
  createSessionboardClient: vi.fn(),
}))

vi.mock('@/features/auth/wiring', () => ({ requireEventRole: mocks.requireEventRole }))
vi.mock('@/features/integrations/authorize', () => ({
  integrationsRole: vi.fn(() => Promise.resolve('admin')),
}))
vi.mock('@/services/airtable/reads-imports', () => ({ getImportRun: mocks.getImportRun }))
vi.mock('@/services/airtable/mutations-imports', () => ({
  createImportRun: mocks.createImportRun,
}))
vi.mock('@/features/imports/run', () => ({ runImport: mocks.runImport }))
vi.mock('@/features/imports/preview', () => ({ previewImport: mocks.previewImport }))
vi.mock('@/features/imports/run-wiring', () => ({
  importRunDeps: mocks.importRunDeps,
  importPreviewDeps: mocks.importPreviewDeps,
}))
vi.mock('@/services/imports/sessionboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/imports/sessionboard')>()),
  createSessionboardClient: mocks.createSessionboardClient,
}))

const {
  advanceImportAction,
  listSessionboardEventsAction,
  previewImportAction,
  startImportAction,
} = await import('@/features/imports/actions')

const run = (overrides: Partial<ImportRun> = {}): ImportRun => ({
  id: RUN_IN_B,
  eventId: EVENT_B,
  source: 'sessionize',
  sourceRef: 'jl4ktls0',
  mapping: EMPTY_IMPORT_MAPPING,
  status: 'queued',
  phase: 'metadata',
  counts: {},
  needsEmail: [],
  ...overrides,
})

const report = {
  runId: RUN_IN_B,
  attempt: 'advanced' as const,
  phases: [],
  counts: {},
  needsEmail: [],
}

const forbidden = () => new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'not an admin on this event', {})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireEventRole.mockResolvedValue({ role: 'admin' })
  mocks.getImportRun.mockResolvedValue(run())
  mocks.createImportRun.mockResolvedValue('recNewRun')
  mocks.runImport.mockResolvedValue(report)
  mocks.previewImport.mockResolvedValue({
    source: 'sessionize',
    sourceRef: 'jl4ktls0',
    counts: {},
    needsEmailCount: 0,
    categories: [],
    warnings: [],
  })
})

describe('advanceImportAction', () => {
  it('refuses a run belonging to another event, even for an admin of the one claimed', async () => {
    // The whole point. The caller holds admin on A, sends A as the event id, and sends a run
    // id whose row names B. `runImport` would write B.
    const result = await advanceImportAction({ eventId: EVENT_A, runId: RUN_IN_B })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.errorId).toBe(ErrorIds.AUTH_FORBIDDEN_ROLE)
    expect(mocks.runImport).not.toHaveBeenCalled()
  })

  it('checks capability against the RUN row event, not the one the caller sent', async () => {
    await advanceImportAction({ eventId: EVENT_B, runId: RUN_IN_B })

    expect(mocks.requireEventRole).toHaveBeenCalledWith(EVENT_B, 'admin')
    expect(mocks.runImport).toHaveBeenCalledWith(RUN_IN_B, expect.anything())
  })

  it('reads the run BEFORE it advances it, so the refusal cannot land after a write', async () => {
    mocks.getImportRun.mockResolvedValue(run({ eventId: EVENT_A }))
    await advanceImportAction({ eventId: EVENT_A, runId: RUN_IN_B })

    expect(mocks.getImportRun.mock.invocationCallOrder.at(0)).toBeLessThan(
      mocks.runImport.mock.invocationCallOrder.at(0) ?? Number.POSITIVE_INFINITY,
    )
  })

  it('advances nothing when the role check on the run event refuses', async () => {
    mocks.requireEventRole.mockRejectedValue(forbidden())
    const result = await advanceImportAction({ eventId: EVENT_B, runId: RUN_IN_B })

    expect(result.ok).toBe(false)
    expect(mocks.runImport).not.toHaveBeenCalled()
  })

  it('carries the token to the wiring and never to the run row', async () => {
    await advanceImportAction({ eventId: EVENT_B, runId: RUN_IN_B, sessionboardToken: 'sb-secret' })

    expect(mocks.importRunDeps).toHaveBeenCalledWith(
      expect.objectContaining({ sessionboardToken: 'sb-secret' }),
    )
  })
})

describe('startImportAction', () => {
  it('authorizes before it creates the row, so a refusal writes no history', async () => {
    mocks.requireEventRole.mockRejectedValue(forbidden())
    const result = await startImportAction({
      eventId: EVENT_A,
      source: 'sessionize',
      sourceRef: 'jl4ktls0',
    })

    expect(result.ok).toBe(false)
    expect(mocks.createImportRun).not.toHaveBeenCalled()
    expect(mocks.runImport).not.toHaveBeenCalled()
  })

  it('creates the run for the authorized event and advances that same row', async () => {
    const result = await startImportAction({
      eventId: EVENT_A,
      source: 'sessionize',
      sourceRef: 'jl4ktls0',
    })

    expect(mocks.requireEventRole).toHaveBeenCalledWith(EVENT_A, 'admin')
    expect(mocks.createImportRun).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT_A, source: 'sessionize', sourceRef: 'jl4ktls0' }),
      'action',
    )
    // In the same call as the create, which is what leaves the cron sweep nothing to claim.
    expect(mocks.runImport).toHaveBeenCalledWith('recNewRun', expect.anything())
    expect(result.ok && result.runId).toBe('recNewRun')
  })

  it('writes the sourceRef verbatim and never a credential beside it', async () => {
    await startImportAction({
      eventId: EVENT_A,
      source: 'sessionboard',
      sourceRef: 'us:412',
      sessionboardToken: 'sb-secret',
    })

    const draft = mocks.createImportRun.mock.calls.at(0)?.at(0) as Record<string, unknown>
    expect(JSON.stringify(draft)).not.toContain('sb-secret')
  })

  it('refuses a source the vocabulary does not hold, before anything is created', async () => {
    // An unchecked source would be written to the row and then fall through
    // `fetchSource`'s final branch to the Accelevents reader, which imports the wrong event
    // rather than erroring.
    await expect(
      startImportAction({ eventId: EVENT_A, source: 'made-up' as 'sessionize', sourceRef: 'x' }),
    ).rejects.toThrow(TypeError)
    expect(mocks.createImportRun).not.toHaveBeenCalled()
  })
})

describe('previewImportAction', () => {
  it('authorizes the one event it reads, and reads nothing when refused', async () => {
    mocks.requireEventRole.mockRejectedValue(forbidden())
    const result = await previewImportAction({
      eventId: EVENT_A,
      source: 'sessionize',
      sourceRef: 'jl4ktls0',
    })

    expect(result.ok).toBe(false)
    expect(mocks.previewImport).not.toHaveBeenCalled()
  })

  it('previews against the authorized event only, so there is no second id to point away', async () => {
    await previewImportAction({ eventId: EVENT_A, source: 'sessionize', sourceRef: 'jl4ktls0' })

    expect(mocks.requireEventRole).toHaveBeenCalledWith(EVENT_A, 'admin')
    expect(mocks.previewImport).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT_A }),
      expect.anything(),
    )
  })

  it('defaults an absent mapping to the empty one rather than to the suggestions', async () => {
    await previewImportAction({ eventId: EVENT_A, source: 'sessionize', sourceRef: 'jl4ktls0' })

    expect(mocks.previewImport).toHaveBeenCalledWith(
      expect.objectContaining({ mapping: EMPTY_IMPORT_MAPPING }),
      expect.anything(),
    )
  })
})

describe('listSessionboardEventsAction', () => {
  it('needs admin on this event before a token is spent on the far side', async () => {
    mocks.requireEventRole.mockRejectedValue(forbidden())
    const result = await listSessionboardEventsAction({
      eventId: EVENT_A,
      region: 'us',
      token: 'sb-secret',
    })

    expect(result.ok).toBe(false)
    expect(mocks.createSessionboardClient).not.toHaveBeenCalled()
  })

  it('labels a nameless event by its id rather than by a placeholder', async () => {
    mocks.createSessionboardClient.mockReturnValue({
      listEvents: () => Promise.resolve([{ id: '412', name: null }]),
    })
    const result = await listSessionboardEventsAction({
      eventId: EVENT_A,
      region: 'eu',
      token: 'sb-secret',
    })

    expect(result.ok && result.events).toEqual([{ id: '412', name: 'Event 412' }])
    expect(mocks.createSessionboardClient).toHaveBeenCalledWith({
      region: 'eu',
      token: 'sb-secret',
    })
  })

  it('refuses a region outside the two Sessionboard serves', async () => {
    await expect(
      listSessionboardEventsAction({ eventId: EVENT_A, region: 'apac', token: 't' }),
    ).rejects.toThrow(TypeError)
    expect(mocks.createSessionboardClient).not.toHaveBeenCalled()
  })
})
