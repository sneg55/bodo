// Mapping for forms, the event-scoped lookups, and the event record itself. Split
// from airtable-mapping.test.ts for the file-size limit; the reasoning for
// hand-written records is in that file's header.

import { describe, expect, it } from 'vitest'

import { isAppError } from '@/constants/errorIds'
import { mapEvent } from '@/services/airtable/mapping'
import { mapForm } from '@/services/airtable/mapping-forms'
import { mapRound, mapTag, mapTrack } from '@/services/airtable/mapping-lookups'
import type { AirtableRecord } from '@/services/airtable/records'

function record(id: string, fields: Record<string, unknown>): AirtableRecord {
  return { id, fields }
}

function errorId(thrown: unknown): string {
  return isAppError(thrown) ? thrown.id : `not an AppError: ${String(thrown)}`
}

function caught(fn: () => unknown): unknown {
  try {
    fn()
    return undefined
  } catch (error) {
    return error
  }
}

/** The minimum a Forms row needs: everything else is a JSON blob or a default. */
const FORM_CORE = {
  event: ['recEvent1'],
  name: 'Call for Speakers 2026',
  publicId: 'cfp2026sandboxdemo01',
}

describe('mapForm', () => {
  it('validates fieldsJson into typed field definitions', () => {
    const form = mapForm(
      record('recForm1', {
        ...FORM_CORE,
        status: 'published',
        fieldsJson: JSON.stringify([
          { id: 'fld_title', type: 'text', label: 'Title', required: true, locked: true },
          {
            id: 'fld_lab',
            type: 'text',
            label: 'Lab setup',
            showIf: { fieldId: 'fld_format', op: 'eq', value: 'workshop' },
          },
        ]),
      }),
    )

    expect(form.fields).toHaveLength(2)
    expect(form.fields.at(0)?.locked).toBe(true)
    // Absent `required` reads as false, so an old blob cannot make a wizard
    // impossible to get past.
    expect(form.fields.at(1)?.required).toBe(false)
    expect(form.fields.at(1)?.showIf?.value).toBe('workshop')
  })

  it('rejects an unknown field type instead of rendering nothing', () => {
    const thrown = caught(() =>
      mapForm(
        record('recForm7', {
          ...FORM_CORE,
          fieldsJson: '[{"id":"fld_x","type":"colorpicker","label":"Pick"}]',
        }),
      ),
    )

    expect(errorId(thrown)).toBe('E_DATA_002')
    expect(isAppError(thrown) ? thrown.message : '').toContain('recForm7')
  })

  it('falls back to the default participant roles when rolesJson is blank', () => {
    const form = mapForm(record('recForm1', FORM_CORE))

    // The default that lets a solo speaker submit: min 1 max 1 on speaker, not two.
    expect(form.roles.at(0)).toEqual({ role: 'speaker', enabled: true, min: 1, max: 1 })
  })

  it('keeps an explicit roles blob, including a disabled role', () => {
    const form = mapForm(
      record('recForm1', {
        ...FORM_CORE,
        rolesJson: JSON.stringify([
          { role: 'speaker', enabled: true, min: 1, max: 2 },
          { role: 'moderator', min: 0, max: 1 },
        ]),
      }),
    )

    expect(form.roles).toHaveLength(2)
    expect(form.roles.at(1)).toEqual({ role: 'moderator', enabled: false, min: 0, max: 1 })
  })

  it('splits the admin alert recipients a human typed into one text column', () => {
    const form = mapForm(
      record('recForm1', {
        ...FORM_CORE,
        adminAlertOnNew: 'one@example.com, two@example.com;three@example.com\n',
      }),
    )

    expect(form.adminAlertOnNew).toEqual([
      'one@example.com',
      'two@example.com',
      'three@example.com',
    ])
    expect(form.adminAlertOnUpdate).toEqual([])
  })

  it('defaults to the reviewed path and to draft', () => {
    const form = mapForm(record('recForm1', FORM_CORE))

    // A blank entityKind must not send an application straight to accepted.
    expect(form.entityKind).toBe('abstracts')
    expect(form.status).toBe('draft')
    expect(form.routing).toEqual({ rules: [], defaultTrackId: undefined })
  })

  it('parses routing rules and the no-match fallback', () => {
    const form = mapForm(
      record('recForm1', {
        ...FORM_CORE,
        routingJson: JSON.stringify({
          rules: [
            { when: { fieldId: 'fld_format', op: 'eq', value: 'workshop' }, trackId: 'recT3' },
          ],
          defaultTrackId: 'recT4',
        }),
      }),
    )

    expect(form.routing.rules).toHaveLength(1)
    expect(form.routing.defaultTrackId).toBe('recT4')
  })
})

describe('lookup mappers', () => {
  it('gives a track with no colour a neutral chip instead of failing', () => {
    const track = mapTrack(record('recT1', { event: ['recEvent1'], name: 'Agents' }))

    expect(track.color).toBe('#64748b')
    expect(track.order).toBe(0)
  })

  it('maps a tag independently of tracks', () => {
    const tag = mapTag(
      record('recTag1', { event: ['recEvent1'], name: 'Live Demo', color: '#0ea5e9' }),
    )

    expect(tag).toEqual({
      id: 'recTag1',
      eventId: 'recEvent1',
      name: 'Live Demo',
      color: '#0ea5e9',
    })
  })

  it('validates round criteria, which scoring.ts then weights', () => {
    const round = mapRound(
      record('recRound1', {
        plan: ['recPlan1'],
        event: ['recEvent1'],
        name: 'Screening',
        order: 1,
        criteriaJson: '[{"key":"relevance","label":"Relevance","min":1,"max":5,"weight":2}]',
      }),
    )

    // `kind` defaults to `numeric`, which is what lets the criterion kinds ship without
    // a data migration: every rubric authored before that column existed is a list of
    // sliders, and reads back as exactly that.
    expect(round.criteria).toEqual([
      { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 2 },
    ])
    expect(round.anonymous).toBe(false)
    // Empty means everyone, not nobody. See `Round.reviewerIds`.
    expect(round.reviewerIds).toEqual([])
  })

  it('reads a dropdown criterion with its options', () => {
    const round = mapRound(
      record('recRound3', {
        plan: ['recPlan1'],
        event: ['recEvent1'],
        name: 'Final',
        order: 2,
        criteriaJson:
          '[{"key":"delivery","label":"Delivery","kind":"select","min":1,"max":3,"weight":1,"options":[{"label":"Weak","value":1},{"label":"Strong","value":3}]}]',
        anonymous: true,
        reviewers: ['recUser1', 'recUser2'],
      }),
    )

    expect(round.criteria.at(0)).toMatchObject({
      kind: 'select',
      options: [
        { label: 'Weak', value: 1 },
        { label: 'Strong', value: 3 },
      ],
    })
    expect(round.anonymous).toBe(true)
    expect(round.reviewerIds).toEqual(['recUser1', 'recUser2'])
  })

  it('rejects criteria missing a weight rather than scoring them as zero', () => {
    const thrown = caught(() =>
      mapRound(
        record('recRound2', {
          plan: ['recPlan1'],
          event: ['recEvent1'],
          name: 'Final',
          criteriaJson: '[{"key":"depth","label":"Depth","min":0,"max":10}]',
        }),
      ),
    )

    expect(errorId(thrown)).toBe('E_DATA_002')
  })
})

describe('mapEvent', () => {
  it('defaults the timezone and the status', () => {
    const event = mapEvent(record('recEvent1', { name: 'AI Engineer Sandbox', slug: 'aies' }))

    // UTC is the guess that is obvious when it is wrong; a local guess is not.
    expect(event.timezone).toBe('UTC')
    expect(event.status).toBe('draft')
    expect(event.eventType).toBe('Conference')
    expect(event.accelSyncEnabled).toBe(false)
  })
})
