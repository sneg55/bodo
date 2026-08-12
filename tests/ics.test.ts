import { assert, describe, expect, it } from 'vitest'

import { buildInvite, type CalendarInviteInput } from '@/features/comms/ics'

type ContentLine = {
  name: string
  parameters: ReadonlyMap<string, string>
  value: string
}

type ParsedCalendar = {
  calendar: readonly ContentLine[]
  event: readonly ContentLine[]
}

const BASE_INVITE: CalendarInviteInput = {
  calendarUid: 'session-42@example.test',
  calendarSequence: 0,
  calendarDtstamp: '2026-08-08T14:05:06.000Z',
  startsAt: '2026-09-12T13:30:00.000Z',
  endsAt: '2026-09-12T14:15:00.000Z',
  organizerEmail: 'program@example.test',
  participantEmails: ['alice@example.test'],
  title: 'Reliable calendar invitations',
  room: 'Room 204',
  portalUrl: 'https://bodo.example.test/portal/submissions/session-42',
}

describe('buildInvite', () => {
  it('builds a request with stored identity and required event properties', () => {
    const text = buildInvite(BASE_INVITE)
    const parsed = parseCalendar(text)

    expect(text.endsWith('\r\n')).toBe(true)
    const withoutCrlf = text.replaceAll('\r\n', '')
    expect(withoutCrlf).not.toContain('\n')
    expect(withoutCrlf).not.toContain('\r')
    expect(valueOf(parsed.calendar, 'VERSION')).toBe('2.0')
    expect(valueOf(parsed.calendar, 'METHOD')).toBe('REQUEST')
    expect(valueOf(parsed.event, 'UID')).toBe(BASE_INVITE.calendarUid)
    expect(valueOf(parsed.event, 'SEQUENCE')).toBe('0')
    expect(valueOf(parsed.event, 'DTSTAMP')).toBe('20260808T140506Z')
    expect(valueOf(parsed.event, 'DTSTART')).toBe('20260912T133000Z')
    expect(valueOf(parsed.event, 'DTEND')).toBe('20260912T141500Z')
    expect(valueOf(parsed.event, 'ORGANIZER')).toBe('mailto:program@example.test')
    expect(textValueOf(parsed.event, 'SUMMARY')).toBe(BASE_INVITE.title)
    expect(textValueOf(parsed.event, 'LOCATION')).toBe(BASE_INVITE.room)
    expect(textValueOf(parsed.event, 'DESCRIPTION')).toBe(BASE_INVITE.portalUrl)
  })

  it('keeps the UID and raises SEQUENCE for an update', () => {
    const created = parseCalendar(buildInvite(BASE_INVITE))
    const updated = parseCalendar(
      buildInvite({
        ...BASE_INVITE,
        calendarSequence: 1,
        calendarDtstamp: '2026-08-09T09:10:11.000Z',
        room: 'Room 310',
      }),
    )

    expect(valueOf(updated.calendar, 'METHOD')).toBe('REQUEST')
    expect(valueOf(updated.event, 'UID')).toBe(valueOf(created.event, 'UID'))
    expect(Number(valueOf(updated.event, 'SEQUENCE'))).toBeGreaterThan(
      Number(valueOf(created.event, 'SEQUENCE')),
    )
    expect(valueOf(updated.event, 'DTSTAMP')).toBe('20260809T091011Z')
  })

  it('cancels with the same identity and cancelled status', () => {
    const cancelled = parseCalendar(
      buildInvite({ ...BASE_INVITE, calendarSequence: 2, calendarStatus: 'cancelled' }),
    )

    expect(valueOf(cancelled.calendar, 'METHOD')).toBe('CANCEL')
    expect(valueOf(cancelled.event, 'UID')).toBe(BASE_INVITE.calendarUid)
    expect(valueOf(cancelled.event, 'SEQUENCE')).toBe('2')
    expect(valueOf(cancelled.event, 'STATUS')).toBe('CANCELLED')
  })

  it('round trips every special character in every TEXT property', () => {
    const special = String.raw`path\segment; first, second
next line`
    const encoded = String.raw`path\\segment\; first\, second\nnext line`
    const parsed = parseCalendar(
      buildInvite({
        ...BASE_INVITE,
        calendarUid: special,
        title: special,
        room: special,
        portalUrl: special,
      }),
    )

    expect(valueOf(parsed.event, 'UID')).toBe(encoded)
    expect(valueOf(parsed.event, 'SUMMARY')).toBe(encoded)
    expect(valueOf(parsed.event, 'LOCATION')).toBe(encoded)
    expect(valueOf(parsed.event, 'DESCRIPTION')).toBe(encoded)
    expect(textValueOf(parsed.event, 'UID')).toBe(special)
    expect(textValueOf(parsed.event, 'SUMMARY')).toBe(special)
    expect(textValueOf(parsed.event, 'LOCATION')).toBe(special)
    expect(textValueOf(parsed.event, 'DESCRIPTION')).toBe(special)
  })

  it('folds only after the 75 octet boundary', () => {
    const atBoundary = buildInvite({ ...BASE_INVITE, title: 'a'.repeat(67) })
    const overBoundary = buildInvite({ ...BASE_INVITE, title: 'a'.repeat(68) })

    expect(physicalPropertyLines(atBoundary, 'SUMMARY')).toHaveLength(1)
    expect(physicalPropertyLines(overBoundary, 'SUMMARY')).toHaveLength(2)
    expect(physicalPropertyLines(overBoundary, 'SUMMARY')[0]).toHaveLength(75)
    expect(physicalPropertyLines(overBoundary, 'SUMMARY')[1]?.startsWith(' ')).toBe(true)
    expect(textValueOf(parseCalendar(overBoundary).event, 'SUMMARY')).toBe('a'.repeat(68))
  })

  it('folds a non ASCII title without splitting a UTF-8 character', () => {
    const title = 'Résumé café 漢字 '.repeat(12)
    const text = buildInvite({ ...BASE_INVITE, title })
    const summaryLines = physicalPropertyLines(text, 'SUMMARY')

    expect(summaryLines.length).toBeGreaterThan(1)
    for (const line of summaryLines) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75)
      expect(new TextDecoder().decode(new TextEncoder().encode(line))).toBe(line)
    }
    expect(textValueOf(parseCalendar(text).event, 'SUMMARY')).toBe(title)
  })

  it('converts offset timestamps to UTC and does not emit a timezone component', () => {
    const parsed = parseCalendar(
      buildInvite({
        ...BASE_INVITE,
        calendarDtstamp: '2026-08-08T10:05:06-04:00',
        startsAt: '2026-09-12T09:30:00-04:00',
        endsAt: '2026-09-12T10:15:00-04:00',
      }),
    )

    expect(valueOf(parsed.event, 'DTSTAMP')).toBe('20260808T140506Z')
    expect(valueOf(parsed.event, 'DTSTART')).toBe('20260912T133000Z')
    expect(valueOf(parsed.event, 'DTEND')).toBe('20260912T141500Z')
    expect(parsed.calendar.some((line) => line.value === 'VTIMEZONE')).toBe(false)
  })

  it('emits one fully configured attendee for every participant', () => {
    const parsed = parseCalendar(
      buildInvite({
        ...BASE_INVITE,
        participantEmails: ['alice@example.test', 'bob@example.test', 'carla@example.test'],
      }),
    )
    const attendees = parsed.event.filter((line) => line.name === 'ATTENDEE')

    expect(attendees.map((line) => line.value)).toEqual([
      'mailto:alice@example.test',
      'mailto:bob@example.test',
      'mailto:carla@example.test',
    ])
    for (const attendee of attendees) {
      expect(Object.fromEntries(attendee.parameters)).toEqual({
        ROLE: 'REQ-PARTICIPANT',
        PARTSTAT: 'NEEDS-ACTION',
        RSVP: 'FALSE',
      })
    }
  })

  it('omits LOCATION when no room is present', () => {
    const parsed = parseCalendar(buildInvite({ ...BASE_INVITE, room: undefined }))

    expect(parsed.event.some((line) => line.name === 'LOCATION')).toBe(false)
  })
})

function parseCalendar(text: string): ParsedCalendar {
  const calendar: ContentLine[] = []
  const event: ContentLine[] = []
  let insideEvent = false

  for (const raw of unfold(text)) {
    const line = parseContentLine(raw)
    if (line.name === 'BEGIN' && line.value === 'VEVENT') {
      insideEvent = true
    } else if (line.name === 'END' && line.value === 'VEVENT') {
      insideEvent = false
    } else if (insideEvent) {
      event.push(line)
    } else {
      calendar.push(line)
    }
  }

  return { calendar, event }
}

function unfold(text: string): readonly string[] {
  const logical: string[] = []
  for (const physical of text.split('\r\n')) {
    if (physical === '') {
      continue
    }
    if (physical.startsWith(' ')) {
      const previous = logical.pop() ?? ''
      logical.push(`${previous}${physical.slice(1)}`)
    } else {
      logical.push(physical)
    }
  }
  return logical
}

function parseContentLine(raw: string): ContentLine {
  const colon = raw.indexOf(':')
  assert.isAtLeast(colon, 0, `content line has no value separator: ${raw}`)
  const [name = '', ...parameterParts] = raw.slice(0, colon).split(';')
  const parameters = new Map<string, string>()
  for (const part of parameterParts) {
    const equals = part.indexOf('=')
    assert.isAtLeast(equals, 0, `parameter has no value separator: ${part}`)
    parameters.set(part.slice(0, equals), part.slice(equals + 1))
  }
  return { name, parameters, value: raw.slice(colon + 1) }
}

function valueOf(lines: readonly ContentLine[], name: string): string {
  const property = lines.find((line) => line.name === name)
  if (property === undefined) {
    assert.fail(`missing ${name} property`)
  }
  return property.value
}

function textValueOf(lines: readonly ContentLine[], name: string): string {
  return valueOf(lines, name)
    .replaceAll('\\n', '\n')
    .replace(/\\([\\;,])/g, '$1')
}

function physicalPropertyLines(text: string, property: string): readonly string[] {
  const lines = text.split('\r\n')
  const start = lines.findIndex((line) => line.startsWith(`${property}:`))
  assert.isAtLeast(start, 0, `missing ${property} property`)
  const folded = [lines.at(start) ?? '']
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(' ')) {
      break
    }
    folded.push(line)
  }
  return folded
}
