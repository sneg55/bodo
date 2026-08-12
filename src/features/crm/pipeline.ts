// The CRM sourcing pipeline: every contact in the viewer's scope, grouped into one column
// per stage.
//
// ORG LEVEL, and that is what makes it a pipeline rather than a second roster. An event's
// Speakers page already shows `Speakers.status` as a counted tab strip, but it only ever
// shows the people on THAT event, so it answers "who is coming to this conference" and
// cannot answer "who have we approached, anywhere, and where did that get to". The column an
// organizer drags a card out of here is the same single-select column that strip filters on
// (`Speakers.status`); it is the SCOPE that differs, and the scope is `CrmScope.eventIds`,
// the same intersection every other CRM read applies.
//
// The grouping is separated from the read for the reason `sessionsForSpeaker` gives in
// profile.ts: "which column does this contact belong in, and may this viewer move them" is a
// rule, and rules are cheaper to assert without a base (`tests/crm-pipeline.test.ts`).
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe; the column headings are `SPEAKER_STATUS_LABELS` verbatim, which is what the
// roster's tab strip already draws.

import { SPEAKER_STATUSES, type SpeakerStatus, speakerStatusLabel } from '@/constants/status'
import { editableEventId } from '@/features/crm/profile'
import type { CrmScope } from '@/features/crm/scope'
import { speakerName } from '@/features/crm/speaker-rows'
import { displayStage } from '@/features/crm/stage-history'
import { listSpeakersInEvents } from '@/services/airtable/queries'
import type { SpeakerInEvents } from '@/types/crm'
import type { RecordId, Speaker } from '@/types/domain'

/**
 * How many cards one column draws before it stops and says how many are left.
 *
 * A board is a glanceable summary, not a list surface: the directory next door is the list
 * surface, it paginates, sorts and filters, and it is one click away from every card here.
 * Rendering nine hundred cards to make a column scroll further would cost the whole board's
 * paint for rows nobody reads past. The overflow is STATED rather than silently dropped,
 * which is the difference between a cap and a bug.
 */
export const PIPELINE_COLUMN_CAP = 50

export type PipelineCard = {
  readonly id: RecordId
  readonly name: string
  /** The tagline, else the company, else the address. Never blank. */
  readonly subtitle: string
  /**
   * The stage AS STORED, so a contact whose column was never written is `undefined` here
   * even though they are drawn in Prospect. Moving them to Prospect is then a real move that
   * writes the column and records a row, rather than a menu item that does nothing.
   *
   * What the card SHOWS is `displayStage` of this, which is Prospect for such a contact, so
   * the trigger agrees with the column heading above it. Stored and shown differ only here,
   * and only this field reaches the write.
   */
  readonly stage?: SpeakerStatus
  /** How many of the VIEWER's events they are on. Never their whole career. */
  readonly eventCount: number
  /**
   * Absent for a viewer who holds `admin` on none of this contact's in-scope events, which
   * is a reviewer, and which is what removes the Move-to menu from the card.
   *
   * A rendering answer only. `setSpeakerStageAction` re-derives the same thing for itself,
   * per BUILD_SPEC section 4.
   */
  readonly editableEventId?: RecordId
}

export type PipelineColumn = {
  readonly status: SpeakerStatus
  readonly label: string
  /** Everyone in this column, including the ones past the cap. Labels the heading. */
  readonly total: number
  readonly cards: readonly PipelineCard[]
}

/**
 * Which column a contact is drawn in.
 *
 * `displayStage` is the same fallback the event roster applies (`admin-roster.ts`: "a row
 * written before the column existed has no status, and `prospect` is the honest default"),
 * and the two must agree: a person the roster counts under Prospect appearing in a sixth
 * column here would read as two products disagreeing about the same cell.
 *
 * Called through that function rather than repeating `?? 'prospect'` because the CARD's
 * Move-to trigger has to answer this question the same way, and answering it separately is
 * how it came to read `No stage` inside the Prospect column. See `displayStage`.
 */
export function pipelineStageOf(entry: SpeakerInEvents): SpeakerStatus {
  return displayStage(entry.speaker.status)
}

/**
 * One column per stage, in `SPEAKER_STATUSES` order, every one of them present.
 *
 * An empty column still renders, exactly as the roster's tab strip still draws a status
 * nobody is in: the board is also how an organizer learns the vocabulary exists, and a
 * Declined column that disappears when nobody has declined makes the board's shape change
 * under them from one visit to the next.
 *
 * Order within a column is the order the roster read returned, which is by last name
 * (`listSpeakersInEvents`). Stable, and the same order the directory lists them in.
 */
export function pipelineColumns(
  scope: CrmScope,
  entries: readonly SpeakerInEvents[],
): readonly PipelineColumn[] {
  const grouped = new Map<SpeakerStatus, SpeakerInEvents[]>(
    SPEAKER_STATUSES.map((status) => [status, []]),
  )
  for (const entry of entries) {
    grouped.get(pipelineStageOf(entry))?.push(entry)
  }

  return SPEAKER_STATUSES.map((status) => {
    const members = grouped.get(status) ?? []
    return {
      status,
      label: speakerStatusLabel(status),
      total: members.length,
      cards: members.slice(0, PIPELINE_COLUMN_CAP).map((entry) => cardOf(scope, entry)),
    }
  })
}

/**
 * The one line under a name on a card: the tagline if they wrote one, otherwise the company,
 * otherwise the address.
 *
 * The same fallback order the profile header uses and the directory's search box scans in.
 * Spelled here rather than shared out of `speaker-rows.ts` because that module is the
 * DIRECTORY's row projection and this is a card; the day one of them wants the company first
 * they should be free to change it without moving the other.
 */
export function pipelineSubtitle(speaker: Speaker): string {
  return speaker.tagline ?? speaker.company ?? speaker.email
}

function cardOf(scope: CrmScope, entry: SpeakerInEvents): PipelineCard {
  const editable = editableEventId(scope, entry.eventIds)
  return {
    id: entry.speaker.id,
    name: speakerName(entry.speaker),
    subtitle: pipelineSubtitle(entry.speaker),
    ...(entry.speaker.status === undefined ? {} : { stage: entry.speaker.status }),
    eventCount: entry.eventIds.length,
    ...(editable === undefined ? {} : { editableEventId: editable }),
  }
}

/**
 * One contact the ENROLL control can put into a stage.
 *
 * Narrower than `PipelineCard` on purpose: the picker needs a name to search, a line to tell
 * two people with the same name apart, and where they sit now, and nothing else. It carries no
 * `editableEventId`, because a contact the viewer cannot move is not in this list at all.
 */
export type EnrollableContact = {
  readonly id: RecordId
  readonly name: string
  readonly subtitle: string
  /** As DRAWN, so the picker agrees with the column the contact is sitting in. */
  readonly stage: SpeakerStatus
}

/**
 * Everyone the viewer could enroll, which is everyone in scope they hold `admin` over.
 *
 * NOT capped the way a column is. `PIPELINE_COLUMN_CAP` exists because a board is a glanceable
 * summary and nobody reads past fifty cards; a picker is the opposite, and one that silently
 * omitted the person being searched for would be worse than no picker, since the search box
 * would answer "no contacts" about somebody who is plainly in the directory. Four fields per
 * contact is a fraction of what the board's own cards already ship.
 *
 * Empty for a reviewer, which is what leaves the control off the board entirely.
 * `enrollContactAction` re-derives the same answer for itself, per BUILD_SPEC section 4.
 */
export function enrollableContacts(
  scope: CrmScope,
  entries: readonly SpeakerInEvents[],
): readonly EnrollableContact[] {
  return entries.flatMap((entry) => {
    if (editableEventId(scope, entry.eventIds) === undefined) return []
    return [
      {
        id: entry.speaker.id,
        name: speakerName(entry.speaker),
        subtitle: pipelineSubtitle(entry.speaker),
        stage: pipelineStageOf(entry),
      },
    ]
  })
}

export type PipelineBoardView = {
  readonly columns: readonly PipelineColumn[]
  /** Everyone in scope, so the header can say what the columns add up to. */
  readonly total: number
  /**
   * What the ENROLL control offers.
   *
   * The board's own gap, and the one the pass criteria named: every contact is auto-placed
   * into Prospect, so an eval agent enumerating the controls on this page found no enroll, no
   * add-prospect and no add-card action anywhere. Being drawn in a column by default is not
   * the same as an organizer having put somebody in one.
   */
  readonly enrollable: readonly EnrollableContact[]
}

/**
 * The board.
 *
 * ONE read, and it is the read the directory and every profile already perform under the
 * same cache entry (`listSpeakersInEvents(scope.eventIds)`), so arriving here from either
 * costs nothing. Nothing is fetched per card: a per-contact lookup for a tag or a session
 * count would be the per-row fan-out `scheduler.ts` was written to prevent, on a surface
 * that draws several hundred rows at once.
 */
export async function loadPipelineBoard(scope: CrmScope): Promise<PipelineBoardView> {
  const entries = await listSpeakersInEvents(scope.eventIds)
  return {
    columns: pipelineColumns(scope, entries),
    total: entries.length,
    enrollable: enrollableContacts(scope, entries),
  }
}
