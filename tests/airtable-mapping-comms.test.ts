// EmailTemplates, mapped from Airtable's own shape.
//
// Written by hand in wire shape rather than round-tripped through the field builders, for
// the reason tests/airtable-mapping-portal.test.ts gives: a round trip agrees with itself
// even when both halves are wrong.
//
// The pressure on this mapper is different from every other one in the DAL, and it is what
// most of these cases are about. This is a table an organizer opens in the Airtable grid,
// where `+` creates a completely blank row, and every SENDER maps the whole table to find
// one key. A mapper that raised on a blank row would turn one stray click into
// DATA_SHAPE_INVALID on the acceptance mail for the entire event. So emptiness is tolerated
// and the wrong TYPE is not.

import { describe, expect, it } from 'vitest'

import { isAppError } from '@/constants/errorIds'
import { mapEmailTemplate } from '@/services/airtable/mapping-comms'
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

describe('mapEmailTemplate', () => {
  it('collapses the event link and reads the whole row', () => {
    const template = mapEmailTemplate(
      record('recTpl1', {
        key: 'accepted',
        event: ['recEvent1'],
        subject: 'You are in for {{event.name}}',
        bodyMarkdown: 'Hi {{speaker.firstName}},\n\nCongratulations.',
        attachIcs: true,
      }),
    )

    expect(template).toEqual({
      id: 'recTpl1',
      eventId: 'recEvent1',
      key: 'accepted',
      subject: 'You are in for {{event.name}}',
      bodyMarkdown: 'Hi {{speaker.firstName}},\n\nCongratulations.',
      attachIcs: true,
    })
  })

  it('reads a row with an EMPTY body without raising, as an empty string', () => {
    // The case `resolveTemplate` rule 2 acts on: an organizer clears the editor to go back
    // to the built-in text, and Airtable then omits the field entirely. That is a template
    // that does not apply, not a corrupt row, and it must not take the read down.
    const template = mapEmailTemplate(record('recTpl2', { key: 'reminder', event: ['recEvent1'] }))

    expect(template.bodyMarkdown).toBe('')
    expect(template.subject).toBe('')
    // An unchecked Airtable checkbox is ABSENT, not false, and absent means do not attach.
    expect(template.attachIcs).toBe(false)
  })

  it('reads a completely blank grid row as belonging to no event and no key', () => {
    // `listByEvent` compares the mapped eventId, so `''` drops the row for every event, and
    // `listEmailTemplates` drops a keyless row on top of that. Neither is a throw, which is
    // the whole point: pressing `+` in Airtable must not stop the event's mail.
    const template = mapEmailTemplate(record('recBlank', {}))

    expect(template.eventId).toBe('')
    expect(template.key).toBe('')
    expect(template.bodyMarkdown).toBe('')
  })

  it('treats an empty-string body the same as an absent one', () => {
    const template = mapEmailTemplate(
      record('recTpl3', { key: 'rejected', event: ['recEvent1'], bodyMarkdown: '' }),
    )

    expect(template.bodyMarkdown).toBe('')
  })

  it('raises on a key that is not text, because that is schema drift', () => {
    // Tolerating emptiness is not tolerating the wrong type: a numeric key means the column
    // is not the one the migration created, and no sender could ever match it.
    expect(errorId(caught(() => mapEmailTemplate(record('recTpl4', { key: 7 }))))).toBe(
      'E_DATA_002',
    )
  })

  it('raises on a body that is not text', () => {
    expect(
      errorId(
        caught(() =>
          mapEmailTemplate(record('recTpl5', { key: 'accepted', bodyMarkdown: { rich: true } })),
        ),
      ),
    ).toBe('E_DATA_002')
  })

  it('raises on an attachIcs that is not a checkbox', () => {
    expect(
      errorId(
        caught(() => mapEmailTemplate(record('recTpl6', { key: 'accepted', attachIcs: 'yes' }))),
      ),
    ).toBe('E_DATA_002')
  })

  it('raises on an event field that is not a link array', () => {
    expect(
      errorId(
        caught(() => mapEmailTemplate(record('recTpl7', { key: 'accepted', event: 'recEvent1' }))),
      ),
    ).toBe('E_DATA_002')
  })

  it('does not read a field named __proto__ off the prototype chain', () => {
    // records.ts copies fields into a Map for exactly this. A base could hold such a column,
    // and the wire JSON would carry it as an OWN property, which a computed key reproduces
    // (a plain `__proto__:` in a literal sets the prototype instead and proves nothing).
    const template = mapEmailTemplate(
      record('recTpl8', {
        key: 'accepted',
        event: ['recEvent1'],
        ['__proto__']: { subject: 'no' },
      }),
    )

    expect(template.subject).toBe('')
  })
})
