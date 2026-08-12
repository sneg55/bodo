import { AppError, ErrorIds } from '@/constants/errorIds'
import { htmlToText } from '@/utils/html-text'

/**
 * The mail pipeline already resolves a submission and its speakers. Accepting only the fields the
 * wire format needs keeps Airtable records out of this pure serializer and makes stored calendar
 * identity impossible to recompute here.
 */
export type CalendarInviteInput = {
  calendarUid: string
  calendarSequence: number
  calendarDtstamp: string
  startsAt: string
  endsAt: string
  organizerEmail: string
  participantEmails: readonly string[]
  title: string
  room?: string
  portalUrl: string
  calendarStatus?: 'active' | 'cancelled'
}

const CRLF = '\r\n'
const MAX_LINE_OCTETS = 75
const ATTENDEE_PARAMETERS = 'ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE'
const encoder = new TextEncoder()

export function buildInvite(input: CalendarInviteInput): string {
  validateInput(input)

  const cancelled = input.calendarStatus === 'cancelled'
  const method = cancelled ? 'CANCEL' : 'REQUEST'
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Bodo//Calendar Invite//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    textProperty('UID', input.calendarUid),
    `SEQUENCE:${input.calendarSequence}`,
    `DTSTAMP:${formatUtc(input.calendarDtstamp, 'calendarDtstamp')}`,
    `DTSTART:${formatUtc(input.startsAt, 'startsAt')}`,
    `DTEND:${formatUtc(input.endsAt, 'endsAt')}`,
    `ORGANIZER:${calendarAddress(input.organizerEmail, 'organizerEmail')}`,
    ...input.participantEmails.map(
      (email, index) =>
        `ATTENDEE;${ATTENDEE_PARAMETERS}:${calendarAddress(email, `participantEmails[${index}]`)}`,
    ),
    textProperty('SUMMARY', input.title),
  ]

  if (input.room !== undefined && input.room.trim() !== '') {
    lines.push(textProperty('LOCATION', input.room))
  }
  lines.push(textProperty('DESCRIPTION', input.portalUrl))
  if (cancelled) {
    lines.push('STATUS:CANCELLED')
  }
  lines.push('END:VEVENT', 'END:VCALENDAR')

  return `${lines.map(foldLine).join(CRLF)}${CRLF}`
}

function validateInput(input: CalendarInviteInput): void {
  requireText(input.calendarUid, 'calendarUid')
  requireText(input.title, 'title')
  requireText(input.portalUrl, 'portalUrl')

  if (!Number.isInteger(input.calendarSequence) || input.calendarSequence < 0) {
    throw new AppError(
      ErrorIds.MAIL_ICS_INVALID,
      'calendarSequence must be a nonnegative integer',
      {
        calendarSequence: input.calendarSequence,
      },
    )
  }

  const start = parseInstant(input.startsAt, 'startsAt')
  const end = parseInstant(input.endsAt, 'endsAt')
  parseInstant(input.calendarDtstamp, 'calendarDtstamp')
  if (end <= start) {
    throw new AppError(ErrorIds.MAIL_ICS_INVALID, 'endsAt must be later than startsAt', {
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    })
  }

  calendarAddress(input.organizerEmail, 'organizerEmail')
  for (const [index, email] of input.participantEmails.entries()) {
    calendarAddress(email, `participantEmails[${index}]`)
  }
}

function requireText(value: string, field: string): void {
  if (value.trim() === '') {
    throw new AppError(ErrorIds.MAIL_ICS_INVALID, `${field} must not be empty`, { field })
  }
}

/**
 * A single bare mailbox. Not a full RFC 5322 grammar, just enough to reject the shapes that
 * actually reach here and produce a broken ORGANIZER or ATTENDEE.
 *
 * The display-name form is the one that matters: Resend permits `EMAIL_FROM` to be
 * `bodo CFP <cfp@example.com>`, and passing that straight through yields
 * `ORGANIZER:mailto:bodo CFP <cfp@example.com>`, which is not a CAL-ADDRESS. Some clients drop the
 * organizer, some refuse the invite, and none of it surfaces as an error. So a caller holding a
 * From header has to extract the address first, and this makes forgetting loud instead of silent.
 *
 * Checked with string operations rather than one regex, because the obvious pattern for a dotted
 * domain nests quantifiers and is a backtracking hazard on attacker-supplied input.
 */
function isBareMailbox(value: string): boolean {
  if (value !== value.trim() || value === '') return false

  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return false

  const local = value.slice(0, at)
  const domain = value.slice(at + 1)

  // Whitespace, angle brackets, and list separators are what a display name or a
  // comma-separated list would bring, and each produces an invalid CAL-ADDRESS.
  if (/[\s<>,;:"()[\]\\]/u.test(value)) return false

  if (local.length === 0) return false

  const labels = domain.split('.')
  if (labels.length < 2) return false
  return labels.every(
    (label) =>
      label.length > 0 &&
      !label.startsWith('-') &&
      !label.endsWith('-') &&
      /^[A-Za-z0-9-]+$/u.test(label),
  )
}

function calendarAddress(email: string, field: string): string {
  if (!isBareMailbox(email)) {
    throw new AppError(
      ErrorIds.MAIL_ICS_INVALID,
      `${field} must be one bare mailbox address, not a display name or a list`,
      { field },
    )
  }
  return `mailto:${email}`
}

/**
 * Pull the address out of a From header so a caller can hand `EMAIL_FROM` straight to the invite
 * builder. Returns the input unchanged when there is no display name.
 */
export function mailboxOf(fromHeader: string): string {
  const angled = /<([^<>]+)>\s*$/u.exec(fromHeader.trim())
  return (angled?.[1] ?? fromHeader).trim()
}

function parseInstant(value: string, field: string): number {
  const instant = Date.parse(value)
  if (Number.isNaN(instant)) {
    throw new AppError(ErrorIds.MAIL_ICS_INVALID, `${field} must be a valid timestamp`, {
      field,
      value,
    })
  }
  return instant
}

// ── The wire format itself ──────────────────────────────────────────────────────────
// Exported rather than private to `buildInvite`, because `buildSessionCalendar` below needs exactly
// these four: a PUBLISH calendar of many VEVENTs is a different document from a METHOD:REQUEST
// invite with an organizer and attendees, built out of the same wire format.

export function formatUtc(value: string, field: string): string {
  const instant = parseInstant(value, field)
  return new Date(instant)
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/u, 'Z')
}

export function textProperty(name: string, value: string): string {
  return `${name}:${escapeText(value)}`
}

export function escapeText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
}

// ── A calendar of many sessions ─────────────────────────────────────────────────────────────
// `METHOD:PUBLISH` and not `REQUEST`, the whole difference from `buildInvite`: a calendar somebody
// subscribes to, not an invitation expecting a reply, so no ORGANIZER, ATTENDEE or SEQUENCE.
// Two callers, one builder: a visitor's starred picks (@/features/cms/personal-schedule) and an
// embed's `.ics` feed (@/features/cms/feed-ics). They differ in PRODID and calendar name and in
// nothing else, and a second serializer would be a second place for the escaping and the 75-octet
// folding to drift, which is where an .ics quietly stops parsing in one client and not another.

/** One session as a calendar entry. `EmbedFeedSession` and `PublicSession` both satisfy it. */
export type CalendarSession = {
  id: string
  title: string
  startsAt?: string
  endsAt?: string
  room?: string
  /** The abstract AS STORED, which is markup. Flattened to text: see DESCRIPTION below. */
  description?: string
}

/**
 * A PUBLISH calendar of sessions. `dtstamp` is passed in rather than read from the clock, so this
 * stays pure.
 *
 * A session with no start or no end is SKIPPED rather than exported with a guessed duration: an
 * agenda can hold a session whose time is still to be announced, and inventing an hour for it puts
 * a wrong time in somebody's calendar. Every instant is written in UTC (`...Z`), which is what
 * makes the file correct in the reader's own timezone: a floating local time would need a VTIMEZONE
 * component to mean anything. So `timeZone` is a DISPLAY hint (`X-WR-TIMEZONE`), and a client that
 * ignores it is still correct.
 */
export function buildSessionCalendar(input: {
  prodId: string
  calendarName: string
  timeZone?: string
  sessions: readonly CalendarSession[]
  dtstamp: string
}): string {
  const events = input.sessions.flatMap((session) => {
    if (session.startsAt === undefined || session.endsAt === undefined) return []
    return [
      'BEGIN:VEVENT',
      // Stable per session, so re-importing after the agenda changed updates the existing
      // entries rather than duplicating the whole calendar.
      textProperty('UID', `${session.id}@bodo`),
      `DTSTAMP:${formatUtc(input.dtstamp, 'dtstamp')}`,
      `DTSTART:${formatUtc(session.startsAt, 'startsAt')}`,
      `DTEND:${formatUtc(session.endsAt, 'endsAt')}`,
      textProperty('SUMMARY', session.title),
      ...optionalProperty('LOCATION', session.room),
      // DESCRIPTION is a TEXT property and carries no markup. A rich-text abstract passed through
      // put `<p>Sharding\, caching\, ...</p>` in front of every subscriber, and the escaping in
      // that output was right all along: the escaper was handed HTML. `htmlToText` and not a tag
      // strip, so a block boundary becomes a `\n` rather than two paragraphs running together.
      ...optionalProperty(
        'DESCRIPTION',
        session.description === undefined ? undefined : htmlToText(session.description),
      ),
      'END:VEVENT',
    ]
  })

  const lines = [
    'BEGIN:VCALENDAR',
    `PRODID:${input.prodId}`,
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // The calendar's own name, which is what most clients show as the imported list.
    textProperty('X-WR-CALNAME', input.calendarName),
    ...(input.timeZone === undefined || input.timeZone === ''
      ? []
      : [textProperty('X-WR-TIMEZONE', input.timeZone)]),
    ...events,
    'END:VCALENDAR',
  ]

  return `${lines.map(foldLine).join(CRLF)}${CRLF}`
}

function optionalProperty(name: string, value: string | undefined): readonly string[] {
  return value === undefined || value.trim() === '' ? [] : [textProperty(name, value)]
}

export function foldLine(line: string): string {
  const physical: string[] = []
  let current = ''
  let currentOctets = 0

  for (const character of line) {
    const characterOctets = encoder.encode(character).byteLength
    if (currentOctets + characterOctets > MAX_LINE_OCTETS) {
      physical.push(current)
      current = ` ${character}`
      currentOctets = 1 + characterOctets
    } else {
      current += character
      currentOctets += characterOctets
    }
  }
  physical.push(current)

  return physical.join(CRLF)
}
