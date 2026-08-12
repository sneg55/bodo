'use server'

// Enrolling a contact into a sourcing stage from the pipeline board.
//
// THE GAP THIS CLOSES. The board moved cards correctly and the moves survived a reload, but
// there was no way to PUT anybody in it: every contact is auto-placed into Prospect by
// `displayStage`, so an agent enumerating the board's controls found no enroll, add-prospect
// or add-card action anywhere. Being drawn in a column by default is not an organizer having
// decided somebody belongs there, and the difference is the whole point of a sourcing
// pipeline: the first deliberate move is the enrollment.
//
// IT COMPOSES THE TWO EXISTING WRITES rather than repeating them, and that is the reason this
// file is three lines of orchestration. `setSpeakerStageAction` owns the stage move, its
// authorization (`requireCrmScope` -> resolve through the caller's own roster ->
// `editableEventId` -> `requireEventRole`) and the stage-history row; `addSpeakerNoteAction`
// owns the note and re-runs the same authorization for itself. A second copy of either rule
// here would be a second place for them to be got slightly differently, which is exactly what
// `stage-actions.ts` says in its own header about there being ONE action behind two surfaces.
// Both are ordinary async functions on the server, so calling them costs no round trip.
//
// The ORDER is the one `markSpeakersInvited` argues for and `setSpeakerStageAction` repeats:
// the stage first, the note after. A note about an enrollment that then failed is a log that
// lies; a landed enrollment whose note failed is a log that is merely incomplete, and only the
// second is something an organizer can see and correct.

import { addSpeakerNoteAction } from '@/features/crm/contact-actions'
import { enrollmentNote } from '@/features/crm/enroll'
import { setSpeakerStageAction } from '@/features/crm/stage-actions'
import { asSpeakerStatus } from '@/features/crm/stage-history'
import { type ActionResult, actionOk } from '@/features/review/action-result'
import type { RecordId } from '@/types/domain'

export type EnrollResult = {
  /** False when the contact was already on that stage, so no move was written. */
  readonly moved: boolean
  /** Whether a note was left as well. False when neither field was filled in. */
  readonly noted: boolean
}

export async function enrollContactAction(input: {
  speakerId: RecordId
  /** Client input, narrowed against `SPEAKER_STATUSES` by `setSpeakerStageAction`. */
  status: string
  /** Optional, and bonus rather than required. See `enrollmentNote`. */
  score?: number
  rationale?: string
}): Promise<ActionResult<EnrollResult>> {
  const moved = await setSpeakerStageAction({
    speakerId: input.speakerId,
    status: input.status,
  })
  if (!moved.ok) return moved

  // Narrowed a second time only to LABEL the note. The move above has already refused an
  // unrecognised value, so this cannot be undefined here; `?? undefined` keeps the type honest
  // without inventing a fallback stage that would put the wrong word in a permanent note.
  const stage = asSpeakerStatus(input.status)
  const note =
    stage === undefined
      ? undefined
      : enrollmentNote({
          stage,
          ...(input.score === undefined ? {} : { score: input.score }),
          ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
        })
  if (note === undefined) return actionOk({ moved: moved.moved, noted: false })

  const noted = await addSpeakerNoteAction({ speakerId: input.speakerId, body: note })
  if (!noted.ok) return noted
  return actionOk({ moved: moved.moved, noted: true })
}
