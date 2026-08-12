// The Abstracts table's row model: one flat, serializable object per submission.
//
// Two reasons this is a feature module and not a renderer. It crosses the server to
// client boundary, so the shape IS the payload, and shipping
// `SubmissionWithParticipants` (every speaker's biography, every answer blob) to
// draw a Speaker chip is the payload mistake BUILD_SPEC section 6.3 names. And the
// lookup joins (track, tags, room, the originating form's name) happen once per
// read here rather than per cell in a renderer.
//
// Nothing here reads Airtable or the clock. It is a projection, so it is testable.

import type { ScheduleStatus, SubmissionStatus } from '@/constants/status'
import { descriptionFieldIds, submissionDescription } from '@/features/review/abstract-text'
import { dateText, dateTimeText } from '@/features/review/date-text'
import type { RatingCell } from '@/features/review/ratings'
import { ratingSortValue, ratingText } from '@/features/review/ratings'
import type { Room, SubmissionWithParticipants, Tag, Track } from '@/types/domain'
import type { Form } from '@/types/forms'

/** A track or tag rendered as a coloured chip. Colour comes from the lookup row. */
export type AbstractChip = { readonly id: string; readonly name: string; readonly color: string }

export type AbstractRow = {
  readonly id: string
  readonly code: string
  readonly title: string
  readonly status: SubmissionStatus
  /** Section 5.1b: false means it was never meant to go through review. */
  readonly reviewRequired: boolean
  /** The originating form's name, or "Manual". Rendered as the grey Source chip. */
  readonly sourceLabel: string
  readonly description: string
  readonly notifiedAt?: string
  readonly submittedAt?: string
  readonly startsAt?: string
  readonly endsAt?: string
  /**
   * The four timestamps above, already formatted in the event's timezone. The ISO values
   * stay alongside because sorting needs them: formatted text sorts "Apr" before "Jan".
   * See date-text.ts for why formatting does not happen in the cell.
   */
  readonly dates: {
    readonly notifiedAt: string
    readonly submittedAt: string
    readonly startsAt: string
    readonly endsAt: string
  }
  readonly roomName?: string
  readonly scheduleStatus: ScheduleStatus
  readonly track?: AbstractChip
  readonly tags: readonly AbstractChip[]
  readonly speakers: readonly string[]
  /**
   * The cast members holding the `chairperson` role, by name.
   *
   * Derived from the participants that are already attached to every submission, so the
   * Chairperson column costs no extra read. A list rather than one name because the role
   * has a max of 1 by default (`DEFAULT_PARTICIPANT_ROLES`) but the schema does not enforce
   * it, and silently showing the first of two would hide the second.
   */
  readonly chairpersons: readonly string[]
  readonly submitterEmail: string
  readonly format?: string
  readonly level?: string
  readonly language?: string
  readonly ceuCredits?: number
  readonly capacity?: number
  readonly location?: string
  readonly clientSessionId?: string
  readonly rating: RatingCell
}

/** What the Source chip says for `source: 'manual'`. Schema section 3. */
export const MANUAL_SOURCE_LABEL = 'Manual'

/** The empty-cell rendering the parity audit records. A hyphen, not a dash. */
export const EMPTY_CELL = '-'

export type AbstractRowLookups = {
  readonly tracks: readonly Track[]
  readonly tags: readonly Tag[]
  readonly rooms: readonly Room[]
  readonly forms: readonly Form[]
  readonly ratings: ReadonlyMap<string, RatingCell>
  /** The event's timezone. Every date column is rendered in it. */
  readonly timeZone: string
}

/**
 * Where a submission's Description lives, and how to flatten it, both moved to
 * `abstract-text.ts` when the reviewer's scorecard turned out to need the same answer.
 *
 * Re-exported because callers already import the key from here. The reason for the
 * indirection is unchanged: Description is a registry field with `column: false`
 * (fields.ts), so the answer is in `answersJson` keyed by the FORM FIELD id, which differs
 * per form, and the form's `registryKey` is the only legal way back to it.
 */
export { MANUAL_DESCRIPTION_KEY } from '@/features/review/abstract-text'

/** How much of a description the cell can show before it truncates anyway. */
const DESCRIPTION_LIMIT = 240

function chipOf(row: Track | Tag): AbstractChip {
  return { id: row.id, name: row.name, color: row.color }
}

function speakerName(speaker: { firstName: string; lastName: string; email: string }): string {
  const full = `${speaker.firstName} ${speaker.lastName}`.trim()
  return full.length > 0 ? full : speaker.email
}

export function buildAbstractRows(
  submissions: readonly SubmissionWithParticipants[],
  lookups: AbstractRowLookups,
): readonly AbstractRow[] {
  const trackById = new Map(lookups.tracks.map((track) => [track.id, chipOf(track)]))
  const tagById = new Map(lookups.tags.map((tag) => [tag.id, chipOf(tag)]))
  const roomById = new Map(lookups.rooms.map((room) => [room.id, room.name]))
  const formNameById = new Map(lookups.forms.map((form) => [form.id, form.name]))
  const descriptionFields = descriptionFieldIds(lookups.forms)

  return submissions.map((submission) => {
    const primary = submission.participants.find((participant) => participant.isPrimary)
    return {
      id: submission.id,
      code: submission.code,
      title: submission.title,
      status: submission.status,
      reviewRequired: submission.reviewRequired,
      sourceLabel:
        submission.formId === undefined
          ? MANUAL_SOURCE_LABEL
          : (formNameById.get(submission.formId) ?? MANUAL_SOURCE_LABEL),
      description: submissionDescription(submission, descriptionFields, DESCRIPTION_LIMIT),
      notifiedAt: submission.notifiedAt,
      submittedAt: submission.submittedAt,
      startsAt: submission.startsAt,
      endsAt: submission.endsAt,
      dates: {
        notifiedAt: dateTimeText(submission.notifiedAt, lookups.timeZone),
        submittedAt: dateText(submission.submittedAt, lookups.timeZone),
        startsAt: dateTimeText(submission.startsAt, lookups.timeZone),
        endsAt: dateTimeText(submission.endsAt, lookups.timeZone),
      },
      roomName: submission.roomId === undefined ? undefined : roomById.get(submission.roomId),
      scheduleStatus: submission.scheduleStatus,
      track: submission.trackId === undefined ? undefined : trackById.get(submission.trackId),
      tags: submission.tagIds.flatMap((tagId) => {
        const tag = tagById.get(tagId)
        return tag === undefined ? [] : [tag]
      }),
      speakers: submission.participants.map((participant) => speakerName(participant.speaker)),
      chairpersons: submission.participants
        .filter((participant) => participant.role === 'chairperson')
        .map((participant) => speakerName(participant.speaker)),
      submitterEmail: primary?.speaker.email ?? '',
      format: submission.format,
      level: submission.level,
      language: submission.language,
      ceuCredits: submission.ceuCredits,
      capacity: submission.capacity,
      location: submission.location,
      clientSessionId: submission.clientSessionId,
      rating: lookups.ratings.get(submission.id) ?? { kind: 'none' },
    }
  })
}
