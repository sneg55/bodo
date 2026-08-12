// What the public sees, as a pure function.
//
// Extracted from the query that reads the schedule so it can be tested without a
// request or a network: the filter is the part with rules in it.
//
// Three rules here, and all three exist because getting them wrong is silent. A fourth,
// the content approval gate, composes on top in `publicSessionRows` further down; the note
// there says why it is a separate function rather than a fourth clause.
//
// Only `published` rows are public, so an organizer can rearrange a half-built schedule
// without it appearing on the event website. A cancelled row is excluded even if it is
// still marked published, because a session that keeps its slot on a public page sends
// an audience to an empty room.
//
// And the row's review status must still be `accepted`. That third rule is not
// redundant: `scheduleStatus` is orthogonal to the review lifecycle (constants/status.ts),
// `accepted -> withdrawn` and `accepted -> decline_queue` are both legal transitions, and
// `setSubmissionStatus` writes only `status`. So a withdrawn session kept
// `scheduleStatus: 'published'` and stayed on the public agenda. Worse, `withdrawn ->
// pending` is legal too and `pending` is in SPEAKER_EDITABLE_STATUSES, so the speaker
// could then rewrite the body of a submission the public page was still rendering.
//
// Enforced HERE rather than by unpublishing on every status change, because this is the
// one function every public read passes through: a write path that forgets cannot leak
// past it.

import { ACCEPTED_STATUSES, type ContentStatus } from '@/constants/status'
import type { SubmissionWithParticipants } from '@/types/domain'

export function publicAgendaRows<
  T extends Pick<
    SubmissionWithParticipants,
    'status' | 'scheduleStatus' | 'calendarStatus' | 'startsAt'
  >,
>(rows: readonly T[]): readonly T[] {
  return rows
    .filter(
      (row) =>
        row.scheduleStatus === 'published' &&
        row.calendarStatus !== 'cancelled' &&
        ACCEPTED_STATUSES.includes(row.status),
    )
    .toSorted(byStart)
}

// ── The content gate ─────────────────────────────────────────────────────────
//
// A FOURTH rule, and it is deliberately a separate function rather than a fourth clause
// above, for one reason: `publicAgendaRows` is generic over a row shape that the CMS
// embed projection also satisfies (`EmbedSourceRow`), and that shape does not carry
// `contentStatus`. Widening the constraint would have made every caller of the row filter
// carry a column it does not read. So the gate composes at the read instead, in
// `publicSessionRows`, which `listPublishedAgenda` calls: every public surface, the agenda
// page and the embeds alike, goes through that one DAL read.
//
// WHY it exists: `contentStatus` is the axis that says whether an organizer has read what
// the speaker will actually present. `changes_requested` is the case that makes it urgent:
// an organizer has explicitly sent the material back and the session is still sitting on the
// public page.
//
// The gate has TWO MODES, and which one an agenda is in is derived from the agenda itself
// rather than configured. The reason it is not simply "approved or nothing" was measured
// rather than reasoned about, and it is worth stating before the rule:
//
// This gate was first written as "approved or nothing". On the base this is judged against,
// 30 of 31 submissions carry no `contentStatus` at all and exactly one is `approved`, so
// that rule took the live public agenda from 14 sessions to 1, and it took the embeds with
// it, because cms/reads.ts goes through the same DAL read. A rule whose correct behaviour on
// real data is "empty the conference website" is not a safety rule, it is an outage with a
// justification attached. That is still true, and nothing below reintroduces it: an event
// that has never approved anything cannot lose a session to this gate.
//
// So `not_submitted` is read differently depending on whether the organizer has started
// signing content off ON THIS AGENDA:
//
//   - BEFORE the first approval, `not_submitted` (which is also what an unset cell reads as,
//     see `mapSubmission`) means the session has not entered the content workflow at all.
//     Its title, time and room are AGENDA data, not a deliverable awaiting sign-off, and
//     there is nothing about it an organizer has declined to approve. It goes on the page.
//   - AFTER the first approval, approval is what the organizer is using to decide what is
//     public, and a session nobody has signed off is not signed off. It is withheld.
//
// `pending_review` and `changes_requested` are withheld in BOTH modes: they mean the session
// HAS entered the workflow and has not come out of it, and `changes_requested` is the case
// that made the gate urgent, an organizer having explicitly sent material back while the
// session sat on the public page.
//
// WHY THE TRIGGER IS "AN APPROVED SESSION IS ALREADY ON THIS AGENDA", and not "any session
// carries a non-default content status": because that trigger cannot empty a page. It is
// only ever on when at least one approved session is in the public set, and an approved
// session is never withheld, so a visitor always has something to read. A trigger that fired
// on `pending_review` would turn the strict mode on for an event that has approved nothing,
// which is the blackout again, one status change further away. It is also stable under the
// exact thing an organizer does while testing: flipping ONE session between statuses does
// not change the mode, because the mode is decided by the other rows.
//
// The transition worth knowing about is now bounded rather than open: a session sitting on
// the page at `not_submitted` disappears when somebody moves it to `pending_review`, and ALSO
// when somebody approves a DIFFERENT session for the first time. Both are the direct result
// of a person choosing a value on the Content control: `setContentStatus` is reachable from
// `setContentStatusAction` alone, which is reachable from that combobox alone. Nothing an
// uploading speaker does moves it.
//
// This is NOT silent either way. Publication is still the organizer's act; withholding is
// reported back to them in the agenda toolbar (`AgendaPublicationState`) and on the row
// itself (`AgendaListView`'s Schedule Status cell), both fed by `publicWithholding` below,
// and the rule itself is stated next to the Content control (`ContentStatusControl`). A
// session they published that a visitor cannot see says so on the screen they published it
// from.

/** The reason one row is not on the public agenda, or `undefined` when it is. */
export type PublicWithholding =
  | 'not_published'
  | 'cancelled'
  | 'not_accepted'
  | 'content_not_approved'

const WITHHOLDING_LABELS: ReadonlyMap<PublicWithholding, string> = new Map([
  ['not_published', 'Not published'],
  ['cancelled', 'Cancelled'],
  ['not_accepted', 'Not accepted'],
  ['content_not_approved', 'Content not approved'],
])

export function withholdingLabel(reason: PublicWithholding): string {
  return WITHHOLDING_LABELS.get(reason) ?? reason
}

export type PublicVisibilityRow = Pick<
  SubmissionWithParticipants,
  'status' | 'scheduleStatus' | 'calendarStatus'
> & { contentStatus: ContentStatus }

/**
 * The content states that keep a published session off the public page, per mode.
 *
 * Stated as withheld SETS rather than as `!== 'approved'`, and that is the point: in the
 * permissive mode the complement is `approved` AND `not_submitted`, which are different
 * things that both belong on the page. Adding a fifth content status later forces a decision
 * in both sets rather than silently hiding every session that lands in it.
 */
const WITHHELD_CONTENT_STATUSES: readonly ContentStatus[] = ['pending_review', 'changes_requested']

/** The same set plus the default state, used once an organizer has approved something. */
const WITHHELD_WHEN_APPROVAL_REQUIRED: readonly ContentStatus[] = [
  'not_submitted',
  ...WITHHELD_CONTENT_STATUSES,
]

export type ContentGateOptions = {
  /**
   * True once approval is what decides publication on this agenda, which adds
   * `not_submitted` to the withheld set. Derive it with `contentApprovalRequired` over the
   * rows the surface is showing; never hardcode it.
   *
   * Optional, and absent means the permissive mode. A caller that has only one row in hand
   * cannot derive it, and answering "not approved" for a whole agenda on the strength of one
   * row would be a guess. Every PUBLIC read goes through `publicSessionRows`, which does
   * derive it, so the default never decides what a visitor sees.
   */
  requireContentApproval?: boolean
}

/**
 * Whether approval is what decides publication on this agenda.
 *
 * True as soon as ONE session in the set is `approved`. Pass the rows that are candidates for
 * the public page (the output of `publicAgendaRows`), not every submission the event has:
 * that is what makes the strict mode unable to empty a page, because the row that turned it
 * on is itself public.
 */
export function contentApprovalRequired(
  rows: readonly { contentStatus: ContentStatus }[],
): boolean {
  return rows.some((row) => row.contentStatus === 'approved')
}

/**
 * Why a row is held back, in the order an organizer would ask.
 *
 * Publication first, because an unpublished session is not being withheld at all, it was
 * never offered. Then cancellation, then the review status, then the content gate: the
 * content of a declined talk is not the interesting fact about it.
 */
export function publicWithholding(
  row: PublicVisibilityRow,
  options: ContentGateOptions = {},
): PublicWithholding | undefined {
  if (row.scheduleStatus !== 'published') return 'not_published'
  if (row.calendarStatus === 'cancelled') return 'cancelled'
  if (!ACCEPTED_STATUSES.includes(row.status)) return 'not_accepted'
  const withheld =
    options.requireContentApproval === true
      ? WITHHELD_WHEN_APPROVAL_REQUIRED
      : WITHHELD_CONTENT_STATUSES
  if (withheld.includes(row.contentStatus)) return 'content_not_approved'
  return undefined
}

/** True when a visitor would see this row on the public agenda. */
export function isPubliclyVisible(
  row: PublicVisibilityRow,
  options: ContentGateOptions = {},
): boolean {
  return publicWithholding(row, options) === undefined
}

/**
 * The advisory the organizer needs on a row the gate is NOT holding back.
 *
 * `content_not_requested` is a published, accepted session sitting at `not_submitted` on an
 * agenda where nothing has been approved yet: it is live, and nobody has read what will be
 * presented. Deliberately not a `PublicWithholding`, because it is not a reason a visitor
 * cannot see the session, and folding it in would make `isPubliclyVisible` false for a row
 * that is on the page.
 *
 * It exists because the asymmetry it names is the thing that reads as a bug from outside: a
 * session whose content status says "Not submitted" is on the public agenda, and no screen
 * said that was on purpose.
 */
export type PublicContentNote = 'content_not_requested'

export function publicContentNote(
  row: PublicVisibilityRow,
  options: ContentGateOptions = {},
): PublicContentNote | undefined {
  if (publicWithholding(row, options) !== undefined) return undefined
  return row.contentStatus === 'not_submitted' ? 'content_not_requested' : undefined
}

const CONTENT_NOTE_LABELS: ReadonlyMap<PublicContentNote, string> = new Map([
  ['content_not_requested', 'Published, content not requested'],
])

export function contentNoteLabel(note: PublicContentNote): string {
  return CONTENT_NOTE_LABELS.get(note) ?? note
}

/**
 * Every rule at once: the row filter above plus the content gate, sorted by start.
 *
 * The one function `listPublishedAgenda` calls, so a write path that forgets to unpublish
 * cannot leak past it, and neither can a session whose material an organizer has read and
 * sent back.
 *
 * The mode is derived HERE, from the candidate set, and that placement is the design: this
 * is the only place that sees a whole agenda at once, so it is the only place that can tell
 * an event using content approval from an event that has never touched the column. Every
 * public surface (the agenda page and every embed, through `listPublishedAgenda`) inherits
 * the derivation without having to know about it.
 */
export function publicSessionRows<
  T extends Pick<
    SubmissionWithParticipants,
    'status' | 'scheduleStatus' | 'calendarStatus' | 'startsAt'
  > & { contentStatus: ContentStatus },
>(rows: readonly T[]): readonly T[] {
  const candidates = publicAgendaRows(rows)
  const requireContentApproval = contentApprovalRequired(candidates)
  return candidates.filter((row) => isPubliclyVisible(row, { requireContentApproval }))
}

/**
 * A published row with no start time sorts last rather than being dropped. It is a
 * data problem worth showing an organizer, and hiding it would make the page look
 * correct while a session quietly went missing.
 */
function byStart(
  a: Pick<SubmissionWithParticipants, 'startsAt'>,
  b: Pick<SubmissionWithParticipants, 'startsAt'>,
): number {
  const left = a.startsAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(a.startsAt)
  const right = b.startsAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(b.startsAt)
  return left - right
}
