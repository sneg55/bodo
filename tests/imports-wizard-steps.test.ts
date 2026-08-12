// The import wizard's step model. BUILD_SPEC 5.0e.
//
// Three rules are pinned here and each one is a data-loss story rather than a navigation
// preference.
//
// THE SUGGESTION IS NEVER APPLIED UNCONFIRMED. Sessionize categories are user-named, so a
// title cannot be read as a type; a wrong guess applied silently turns a Track taxonomy
// into tags and the organizer finds out after the run has written everything. The gate has
// to stay shut on an unanswered category, and it has to stay shut while the categories are
// still unknown, which are two different states that look identical from `categories.length`.
//
// THE TOKEN IS NOT PART OF THE IDENTITY. `sourceRef` is written to an Airtable column every
// collaborator on the event can read, so a credential must never reach it, and the step
// gate has to check the token separately or a Sessionboard run walks to a preview that
// cannot authenticate and reports a 401 as a wrong event id.
//
// THE MAPPING STEP EXISTS FOR ONE SOURCE. The other two type their taxonomies on their own
// side, and a step that renders "nothing to do here" is a step to delete.

import { describe, expect, it } from 'vitest'

import {
  completedImportSteps,
  credentialsReady,
  EMPTY_IMPORT_CREDENTIALS,
  IMPORT_ATTEMPT_MESSAGES,
  type ImportCredentials,
  type ImportWizardState,
  importProgressPercent,
  importWizardSteps,
  needsCategoryMapping,
  shouldKeepAdvancing,
  sourceRefFor,
} from '@/features/imports/wizard-steps'
import {
  EMPTY_IMPORT_MAPPING,
  type ImportCategoryPreview,
  type ImportSource,
} from '@/types/imports'

const creds = (overrides: Partial<ImportCredentials> = {}): ImportCredentials => ({
  ...EMPTY_IMPORT_CREDENTIALS,
  ...overrides,
})

const category = (id: string): ImportCategoryPreview => ({
  id,
  title: 'Track',
  itemCount: 3,
  suggested: 'track',
})

const state = (overrides: Partial<ImportWizardState> = {}): ImportWizardState => ({
  source: 'sessionize',
  credentials: creds({ endpointId: 'jl4ktls0' }),
  mapping: EMPTY_IMPORT_MAPPING,
  categories: [],
  categoriesKnown: false,
  started: false,
  ...overrides,
})

const stepIds = (source: ImportSource): readonly string[] =>
  importWizardSteps(source).map((step) => step.id)

describe('importWizardSteps', () => {
  it('never renders a source step, because the route already named the source', () => {
    for (const source of ['sessionize', 'sessionboard', 'accelevents'] as const) {
      expect(stepIds(source)).not.toContain('source')
    }
  })

  it('gives the mapping step to Sessionize alone', () => {
    expect(stepIds('sessionize')).toEqual(['credentials', 'mapping', 'preview', 'run'])
    expect(stepIds('sessionboard')).toEqual(['credentials', 'preview', 'run'])
    expect(stepIds('accelevents')).toEqual(['credentials', 'preview', 'run'])
    expect(needsCategoryMapping('sessionboard')).toBe(false)
  })

  it('titles the credentials step per source, since Accelevents asks for no credential', () => {
    const titleOf = (source: ImportSource) => importWizardSteps(source).at(0)?.title
    expect(titleOf('sessionize')).toBe('Endpoint')
    expect(titleOf('sessionboard')).toBe('Token and event')
    expect(titleOf('accelevents')).toBe('Connection')
  })
})

describe('sourceRefFor', () => {
  it('never carries the Sessionboard token, which is stored in a readable column', () => {
    const ref = sourceRefFor('sessionboard', creds({ token: 'sb-secret', remoteEventId: '412' }))
    expect(ref).toBe('us:412')
    expect(ref).not.toContain('sb-secret')
  })

  it('pairs the region with the event id, because an EU token on the US host answers 401', () => {
    expect(sourceRefFor('sessionboard', creds({ region: 'eu', remoteEventId: '9' }))).toBe('eu:9')
  })

  it('is undefined rather than blank while the organizer is still typing', () => {
    expect(sourceRefFor('sessionize', creds())).toBeUndefined()
    expect(sourceRefFor('sessionboard', creds({ token: 'x' }))).toBeUndefined()
    expect(sourceRefFor('accelevents', creds({ acceleventsRef: '   ' }))).toBeUndefined()
  })

  it('passes the Accelevents ref through in the shape parseAcceleventsRef reads', () => {
    expect(sourceRefFor('accelevents', creds({ acceleventsRef: '77:ai-engineer' }))).toBe(
      '77:ai-engineer',
    )
  })
})

describe('credentialsReady', () => {
  it('refuses a Sessionboard event with no token, since the ref cannot carry one', () => {
    expect(credentialsReady('sessionboard', creds({ remoteEventId: '412' }))).toBe(false)
    expect(credentialsReady('sessionboard', creds({ remoteEventId: '412', token: 't' }))).toBe(true)
  })

  it('asks Sessionize and Accelevents for no token at all', () => {
    expect(credentialsReady('sessionize', creds({ endpointId: 'jl4ktls0' }))).toBe(true)
    expect(credentialsReady('accelevents', creds({ acceleventsRef: 'ai-engineer' }))).toBe(true)
  })
})

describe('completedImportSteps', () => {
  it('holds the mapping step shut while the categories are merely unknown', () => {
    // The failure this exists to prevent: `categories.length === 0` is both "this event has
    // none" and "nobody has looked yet", and the second must not satisfy the step.
    expect(completedImportSteps(state({ categoriesKnown: false })).has('mapping')).toBe(false)
    expect(completedImportSteps(state({ categoriesKnown: true })).has('mapping')).toBe(true)
  })

  it('holds it shut until EVERY category has a confirmed target', () => {
    const categories = [category('1'), category('2')]
    const partial = state({
      categories,
      categoriesKnown: true,
      mapping: { categories: { '1': 'track' } },
    })
    expect(completedImportSteps(partial).has('mapping')).toBe(false)

    const full = state({
      categories,
      categoriesKnown: true,
      mapping: { categories: { '1': 'track', '2': 'tag' } },
    })
    expect(completedImportSteps(full).has('mapping')).toBe(true)
  })

  it('completes the preview step only once a run row exists, never on counts alone', () => {
    // This is "nothing is written until Import is pressed" expressed as navigation: the run
    // step describes a row, so it is unreachable while there is no row to describe.
    expect(completedImportSteps(state({ started: false })).has('preview')).toBe(false)
    expect(completedImportSteps(state({ started: true })).has('preview')).toBe(true)
  })

  it('reports the credentials step off the same rule the ref parser uses', () => {
    expect(completedImportSteps(state()).has('credentials')).toBe(true)
    expect(completedImportSteps(state({ credentials: creds() })).has('credentials')).toBe(false)
  })
})

describe('importProgressPercent', () => {
  it('counts the phases this tab watched finish, not the row column', () => {
    expect(importProgressPercent('running', [])).toBe(0)
    expect(importProgressPercent('running', ['metadata'])).toBe(25)
    expect(importProgressPercent('running', ['metadata', 'speakers'])).toBe(50)
  })

  it('ignores a phase reported twice, since a resumed run can re-report one', () => {
    expect(importProgressPercent('running', ['metadata', 'metadata'])).toBe(25)
  })

  it('pins a finished run to 100, because a bar stuck at 75 reads as a hang', () => {
    expect(importProgressPercent('done', ['metadata'])).toBe(100)
  })
})

describe('attempt reporting', () => {
  it('keeps calling only while the engine says it advanced', () => {
    expect(shouldKeepAdvancing('advanced')).toBe(true)
    for (const attempt of ['done', 'failed', 'contended', 'fenced', 'terminal', 'no-client']) {
      expect(shouldKeepAdvancing(attempt)).toBe(false)
    }
  })

  it('names the token as the fix for no-client, which is the documented cron behaviour', () => {
    expect(IMPORT_ATTEMPT_MESSAGES.get('no-client')).toContain('token')
  })

  it('has a sentence for every attempt the engine can report', () => {
    for (const attempt of [
      'done',
      'advanced',
      'failed',
      'contended',
      'fenced',
      'terminal',
      'no-client',
    ]) {
      expect(IMPORT_ATTEMPT_MESSAGES.get(attempt)).toBeTypeOf('string')
    }
  })
})
