// The pipeline stage as a RULE: what counts as a move, what one move records, and how the
// recorded moves render.
//
// Pure, so `tests/crm-stage-history.test.ts` asserts all three without a base and without a
// clock. It exists because three places have to agree about the same question: the profile's
// Move-to menu, the pipeline board's Move-to menu, and `setSpeakerStageAction` behind both.
// A check that lives only in a menu is a check anybody can POST past, and a check that lives
// in two menus is two checks that will eventually disagree.
//
// The vocabulary itself is `SPEAKER_STATUSES` in constants/status.ts and is not restated
// here. What is here is what that vocabulary does not say: that moving a contact to the
// stage they are already on is not a move, and that a contact with no stage at all is a real
// starting point rather than a missing value.

import { SPEAKER_STATUSES, type SpeakerStatus, speakerStatusLabel } from '@/constants/status'
import { dateTimeText } from '@/features/review/date-text'
import type {
  SpeakerStageChange,
  StageChangeDraft,
} from '@/services/airtable/speaker-stage-history'
import type { RecordId } from '@/types/domain'

/** What a contact with no `Speakers.status` at all renders as in a HISTORY. See below. */
export const NO_STAGE_LABEL = 'No stage'

/**
 * The stage a contact is FILED UNDER, as opposed to the one stored on their record.
 *
 * A contact whose `Speakers.status` was never written is grouped as `prospect` by every
 * surface in this app that groups by it: the event roster's counted tab strip
 * (`admin-roster.ts`), the task roster (`roster-scope.ts`), the CRM dashboard's status
 * breakdown (`dashboard.ts`), the speaker editor's default (`editable-speaker.ts`), and the
 * pipeline board's columns (`pipelineStageOf`). `types/domain.ts` states it once for all of
 * them: "absent reads as `prospect` at the surfaces that group by it".
 *
 * The eval run of 2026-08-10 filed the one place that did NOT: a card sitting in the pipeline
 * board's Prospect column, and counted in that column's total, whose own Move-to trigger read
 * `No stage`. Two answers to one question on one card. This function is the single answer, so
 * a card cannot contradict the column it is in.
 *
 * The stage-less contacts are NOT given a column of their own, and that was the alternative.
 * Two reasons against it. The board is org-scoped and so is the dashboard's status
 * breakdown, so a sixth column would make `Prospect 1 / No stage 14` here disagree with
 * `Prospect 15` there for exactly the same people, which is the same defect one page over.
 * And `prospect` is not a euphemism for "unknown": it is the first stage of the pipeline, and
 * somebody nobody has approached yet is precisely a prospect.
 *
 * NOTHING ABOUT THE WRITE CHANGES. The stored value stays `undefined` on the card and in the
 * action, so a contact's first move is still a real move that writes the column and appends
 * `'' -> Prospect` to their history (`isStageMove`, `stageChangeDraft`). This is a rendering
 * answer only, which is why the history keeps `NO_STAGE_LABEL`: a log row says what was
 * stored at the time, and "No stage to Invited" is a fact worth keeping.
 */
export function displayStage(stored: SpeakerStatus | undefined): SpeakerStatus {
  return stored ?? 'prospect'
}

/** The closed list, narrowed from client input. `undefined` for anything outside it. */
export function asSpeakerStatus(value: string): SpeakerStatus | undefined {
  return SPEAKER_STATUSES.find((known) => known === value)
}

/**
 * Whether moving from `from` to `to` is a move at all.
 *
 * The one rule that matters, and it is about the LOG rather than about permission: a stage
 * is a single select, so "set it to Invited" from Invited writes the value that is already
 * there and changes nothing. Recording that would fill a contact's history with rows saying
 * an organizer did something they did not do, which is the failure mode an append-only log
 * has no way to correct afterwards.
 *
 * A contact with no stage yet is `undefined` here and compares unequal to every status, so
 * their first move is a real one and is recorded as `'' -> prospect`.
 */
export function isStageMove(from: SpeakerStatus | undefined, to: SpeakerStatus): boolean {
  return from !== to
}

/**
 * The row one move appends, or `undefined` when nothing moved.
 *
 * `undefined` rather than a throw: a menu that offers every stage will be clicked on the
 * current one, and refusing that is worse than doing nothing, because the organizer asked
 * for a state the record is already in and got it.
 *
 * `from` is stored as the EMPTY STRING for a contact who had no stage, matching what
 * `mapSpeakerStageChange` reads back: an absent value on a log row is indistinguishable from
 * a column that failed to write, and "no stage to Invited" is a fact worth keeping.
 */
export function stageChangeDraft(input: {
  speakerId: RecordId
  from: SpeakerStatus | undefined
  to: SpeakerStatus
  authorName: string
  at: string
}): StageChangeDraft | undefined {
  if (!isStageMove(input.from, input.to)) return undefined
  return {
    speakerId: input.speakerId,
    from: input.from ?? '',
    to: input.to,
    authorName: input.authorName,
    at: input.at,
  }
}

/** A stage value rendered for a reader: the label when it is known, the raw string when not. */
export function stageLabel(value: string): string {
  if (value === '') return NO_STAGE_LABEL
  const known = asSpeakerStatus(value)
  return known === undefined ? value : speakerStatusLabel(known)
}

/**
 * One history row with everything the surface renders already resolved.
 *
 * The timestamp is formatted HERE, on the server, for the reason `features/review/date-text.ts`
 * records: the panel is a client component, and a client that formatted a timestamp itself
 * would disagree with the server whenever their timezones differ, which is a hydration
 * mismatch on a list of nothing but dates.
 */
export type StageHistoryRow = {
  readonly id: RecordId
  readonly fromLabel: string
  readonly toLabel: string
  readonly authorName: string
  readonly atText: string
}

/**
 * The rendered history, in the order it was read (newest first).
 *
 * ONE timezone for the whole list, unlike the communication timeline beside it, and that is
 * a consequence of the schema rather than an inconsistency: an outbox row names the event it
 * was sent for, so each line can be shown in that venue's zone, while a stage is one column
 * on the person's row and belongs to no event. The caller passes the contact's first in-scope
 * event's zone so the two panels agree on a profile, and `'UTC'` when there is none.
 */
export function stageHistoryRows(
  changes: readonly SpeakerStageChange[],
  timezone: string,
): readonly StageHistoryRow[] {
  return changes.map((change) => ({
    id: change.id,
    fromLabel: stageLabel(change.from),
    toLabel: stageLabel(change.to),
    authorName: change.authorName,
    atText: dateTimeText(change.at, timezone),
  }))
}
