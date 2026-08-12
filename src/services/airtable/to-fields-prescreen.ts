// The write direction for AiPrescreenJobs.
//
// Same rules as to-fields.ts, which is why this is a separate file rather than three more
// functions in it: a link goes out as an ARRAY even when it holds one id, and a key whose
// value is `undefined` is dropped so the column keeps whatever it already had. That second
// rule is what makes `prescreenJobPatchFields` safe to call with a partial patch: the
// failure write names `error` and leaves `startedAt` alone, and the success write names
// neither and leaves both.

import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import type { AiPrescreenStatus } from '@/types/prescreen'

export type PrescreenJobDraft = {
  readonly eventId: RecordId
  readonly roundId: RecordId
  readonly submissionId: RecordId
  readonly queuedAt: string
}

/**
 * A newly enqueued job. `status` and `attempts` are written explicitly rather than left to
 * Airtable's defaults, because an empty select would fail `requiredChoice` on read and an
 * absent number would read as `undefined` where the retry cap expects a count.
 */
export function prescreenJobFields(draft: PrescreenJobDraft): FieldSet {
  return compact({
    [COL.event]: link(draft.eventId),
    [COL.round]: link(draft.roundId),
    [COL.submission]: link(draft.submissionId),
    [COL.status]: 'queued' satisfies AiPrescreenStatus,
    [COL.attempts]: 0,
    [COL.queuedAt]: draft.queuedAt,
  })
}

export type PrescreenJobPatchFields = {
  readonly status: AiPrescreenStatus
  readonly attempts?: number
  readonly error?: string
  readonly startedAt?: string
  readonly finishedAt?: string
  /** Written on the outcome, where it is known. `false` survives `compact`. */
  readonly mocked?: boolean
}

export function prescreenJobPatchFields(patch: PrescreenJobPatchFields): FieldSet {
  return compact({
    [COL.status]: patch.status,
    [COL.attempts]: patch.attempts,
    [COL.error]: patch.error,
    [COL.startedAt]: patch.startedAt,
    [COL.finishedAt]: patch.finishedAt,
    [COL.mocked]: patch.mocked,
  })
}

/**
 * A superseded row, back at the head of the queue.
 *
 * Not built through `compact`, because every key here has to be SENT: the three instants
 * and the error belong to the sample run, and omitting them (which is what `undefined`
 * means to a patch) would leave the live result dated to the run it replaced. `null` is how
 * Airtable clears a column.
 */
export function prescreenJobResetFields(): FieldSet {
  return {
    [COL.status]: 'queued' satisfies AiPrescreenStatus,
    [COL.attempts]: 0,
    [COL.mocked]: false,
    [COL.error]: null,
    [COL.startedAt]: null,
    [COL.finishedAt]: null,
  }
}
