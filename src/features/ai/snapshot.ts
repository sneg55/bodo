// The event digest that goes into the prompt.
//
// Pure, and separate from the reads that feed it, because everything worth getting right
// here is about strings and caps rather than about Airtable.
//
// **Line-oriented, id first.** One record per line, leading with its Airtable id, because
// the id is the only handle the model has for citing a row. `resolveRefs` checks whatever
// comes back against `ids`, so a row that reached the prompt without its id can be
// described in an answer but never linked to.
//
// **Nothing is truncated silently.** The header carries the real total and `truncated`
// names any capped section, which is the same rule `globalSearchGroups` already follows
// for the palette: a capped list that looks identical to a complete one teaches the
// reader that the missing rows do not exist.
//
// **Free text is flattened before it is written.** A title holding a newline could
// otherwise close its own line and open a second one that reads exactly like a real
// record, which is a row the model would then cite by an id nothing can resolve.

import type { Event, Room, Speaker, SubmissionWithParticipants, Track } from '@/types/domain'

/** Per section, before the cap is reported. */
export const SNAPSHOT_LIMIT = 300

/** Field separator inside a record line. Two spaces, so single-spaced prose cannot fake it. */
const SEP = '  '

export type SnapshotInput = {
  event: Event
  tracks: readonly Track[]
  rooms: readonly Room[]
  submissions: readonly SubmissionWithParticipants[]
  speakers: readonly Speaker[]
}

export type EventSnapshot = {
  /** The prompt text. Carries the cache breakpoint at the call site. */
  text: string
  /** What actually went in, so a returned ref can be checked against it. */
  ids: { submissions: readonly string[]; speakers: readonly string[] }
  /** Section names that were capped. Empty when everything fit. */
  truncated: readonly string[]
}

/**
 * Collapse anything a human typed into one line's worth of text.
 *
 * Newlines first, then runs of whitespace, so a value cannot end its own record line NOR
 * forge the two-space field separator in the middle of one.
 */
function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** A heading that states the real total even when the list below it was cut. */
function heading(label: string, total: number, shown: number): string {
  return total > shown
    ? `# ${label} (${total} total, showing the first ${shown})`
    : `# ${label} (${total})`
}

function speakerName(speaker: Speaker): string {
  return flatten(`${speaker.firstName} ${speaker.lastName}`)
}

/**
 * The two dates are independently optional on `Event`, so they are formatted
 * independently. A start with no end used to render `dates: <start> to undefined`, which
 * is worse than saying nothing: it puts a literal `undefined` in front of the model as if
 * it were a value. Found by Codex review.
 */
function dateLine(event: Event): string {
  const parts = [
    event.startsAt === undefined ? undefined : `starts ${event.startsAt}`,
    event.endsAt === undefined ? undefined : `ends ${event.endsAt}`,
  ].filter((part) => part !== undefined)
  return `dates: ${parts.length === 0 ? 'not set' : parts.join(', ')}`
}

function eventBlock(event: Event): string {
  const dates = dateLine(event)
  return [
    '# Event',
    `name: ${flatten(event.name)}`,
    dates,
    `timezone: ${event.timezone}`,
    `status: ${event.status}`,
  ].join('\n')
}

function namesBlock(label: string, names: readonly string[]): string {
  return [heading(label, names.length, names.length), ...names.map(flatten)].join('\n')
}

function submissionLine(
  submission: SubmissionWithParticipants,
  trackNames: ReadonlyMap<string, string>,
): string {
  const track = submission.trackId === undefined ? undefined : trackNames.get(submission.trackId)
  const speakers = submission.participants.map((participant) => speakerName(participant.speaker))
  return [
    submission.id,
    submission.code,
    `status=${submission.status}`,
    `schedule=${submission.scheduleStatus}`,
    // Flattened here as well as in the Tracks section: this is the second place the same
    // name is written, and a value going in raw can forge the separator. Codex review.
    `track=${track === undefined ? 'none' : flatten(track)}`,
    `speakers=${speakers.length === 0 ? 'none' : speakers.join(', ')}`,
    flatten(submission.title),
  ].join(SEP)
}

function speakerLine(speaker: Speaker): string {
  return [
    speaker.id,
    speakerName(speaker),
    // Airtable does not guarantee this is clean, and nothing else on the line does it.
    flatten(speaker.email),
    `bio=${speaker.bio === undefined || speaker.bio.trim() === '' ? 'no' : 'yes'}`,
    `company=${speaker.company === undefined ? 'none' : flatten(speaker.company)}`,
    `headshot=${speaker.headshotUrl === undefined ? 'no' : 'yes'}`,
  ].join(SEP)
}

export function buildEventSnapshot(input: SnapshotInput): EventSnapshot {
  const trackNames = new Map(input.tracks.map((track) => [track.id, track.name]))
  const submissions = input.submissions.slice(0, SNAPSHOT_LIMIT)
  const speakers = input.speakers.slice(0, SNAPSHOT_LIMIT)

  const truncated: string[] = []
  if (input.submissions.length > submissions.length) truncated.push('submissions')
  if (input.speakers.length > speakers.length) truncated.push('speakers')

  const text = [
    eventBlock(input.event),
    namesBlock(
      'Tracks',
      input.tracks.map((track) => track.name),
    ),
    namesBlock(
      'Rooms',
      input.rooms.map((room) => room.name),
    ),
    [
      heading('Submissions', input.submissions.length, submissions.length),
      ...submissions.map((submission) => submissionLine(submission, trackNames)),
    ].join('\n'),
    [
      heading('Speakers', input.speakers.length, speakers.length),
      ...speakers.map(speakerLine),
    ].join('\n'),
  ].join('\n\n')

  return {
    text,
    ids: {
      submissions: submissions.map((submission) => submission.id),
      speakers: speakers.map((speaker) => speaker.id),
    },
    truncated,
  }
}
