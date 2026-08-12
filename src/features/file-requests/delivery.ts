// Who has delivered a requested document and who has not.
//
// The same arithmetic `speakerProgress` does for tasks, over the other table, and it is a
// separate function rather than a generalisation of that one on purpose: the two differ in
// what a row MEANS (a task is done by the speaker, a request is satisfied by a verified file)
// and in the words the surface uses, and collapsing them would produce one function with a
// `kind` parameter and two sets of labels. The dedup rule is the part that mattered and that
// is shared through `requestAssignmentKey`, which is the same tuple key.
//
// Every case below was a wrong answer waiting to happen, and each is asserted in
// tests/file-requests-delivery.test.ts:
//
//   - A speaker with nothing requested of them reads `0/0` at 0 per cent, not `NaN%`, and is
//     not counted as having delivered everything.
//   - Two rows for the same (request, speaker, submission) are ONE document. Airtable has no
//     unique constraint, so `planRequestAssignments` is the only thing stopping a duplicate,
//     and a row added in the base by hand would otherwise inflate the denominator.
//   - An assignment whose REQUEST record is gone is dropped upstream by `fileRequestItems`.
//     An assignment whose SPEAKER is gone is dropped here, because the scopes are the roster
//     and a row pointing outside it has nobody to be outstanding for.

import { dedupeRequestAssignments, requestAssignmentKey } from '@/features/file-requests/plan'
import { type SpeakerScope, speakerDisplayName } from '@/features/tasks/scope'
import type { FileRequestItem } from '@/services/airtable/reads-requests'
import type { RecordId } from '@/types/domain'

export type DeliveryRow = {
  speakerId: RecordId
  name: string
  email: string
  /** Distinct documents requested of this speaker. */
  requested: number
  received: number
  outstanding: number
  /** `1/3`, the same shape the onboarding table uses. */
  label: string
  /** 0 to 100, rounded. 0 rather than NaN when nothing is requested. */
  percent: number
  /** The titles still missing, so the table can say what to chase. */
  outstandingTitles: readonly string[]
  /** True when at least one of the missing documents is marked required. */
  missingRequired: boolean
}

export function deliveryRows(input: {
  scopes: readonly SpeakerScope[]
  items: readonly FileRequestItem[]
  /**
   * Submission id to its `SESS-n` code, so a per-session request can say WHICH session is
   * outstanding.
   *
   * Without it the missing list read "Upload Session Presentation" for a speaker who had
   * just delivered a deck, because a speaker with three accepted sessions owes one deck per
   * session and the title is the same for all three. The count was right and the sentence
   * looked like a bug: an organizer reading it concluded the upload had not registered.
   */
  codeBySubmission?: ReadonlyMap<RecordId, string>
}): readonly DeliveryRow[] {
  const bySpeaker = groupBySpeaker(input.items, input.codeBySubmission)
  const none: ReadonlyMap<string, Deduped> = new Map()

  return input.scopes.map((scope) => {
    const deduped = [...(bySpeaker.get(scope.speaker.id) ?? none).values()]
    const received = deduped.filter((entry) => entry.received).length
    const missing = deduped.filter((entry) => !entry.received)

    return {
      speakerId: scope.speaker.id,
      name: speakerDisplayName(scope.speaker),
      email: scope.speaker.email,
      requested: deduped.length,
      received,
      outstanding: deduped.length - received,
      label: `${received}/${deduped.length}`,
      percent: deduped.length === 0 ? 0 : Math.round((received / deduped.length) * 100),
      outstandingTitles: missing
        .map((entry) => entry.title)
        .sort((left, right) => left.localeCompare(right)),
      missingRequired: missing.some((entry) => entry.required),
    }
  })
}

type Deduped = { received: boolean; title: string; required: boolean }

/**
 * What to call one outstanding document.
 *
 * A per-session request is owed once PER SESSION, so its title alone repeats and says
 * nothing about which one is missing. The code disambiguates without inventing a second
 * column: `Upload Session Presentation (SESS-4)`. An unscoped request keeps its bare title,
 * because there is only ever one of it.
 */
function titleOf(item: FileRequestItem, codeBySubmission?: ReadonlyMap<RecordId, string>): string {
  const submissionId = item.assignment.submissionId
  if (submissionId === undefined) return item.request.title
  const code = codeBySubmission?.get(submissionId)
  return code === undefined ? item.request.title : `${item.request.title} (${code})`
}

/**
 * Assignments folded to one entry per uniqueness tuple, per speaker.
 *
 * Where two rows describe the same document, `received` wins: the file arrived, and chasing
 * a speaker for something they already sent because a stray duplicate row exists is the
 * failure that matters here. The reverse default would be worse in exactly the way this
 * surface is used, which is deciding who to email.
 */
function groupBySpeaker(
  items: readonly FileRequestItem[],
  codeBySubmission?: ReadonlyMap<RecordId, string>,
): ReadonlyMap<RecordId, ReadonlyMap<string, Deduped>> {
  const bySpeaker = new Map<RecordId, Map<string, Deduped>>()

  for (const item of items) {
    const key = requestAssignmentKey({
      fileRequestId: item.request.id,
      speakerId: item.assignment.speakerId,
      submissionId: item.assignment.submissionId,
    })
    const forSpeaker = bySpeaker.get(item.assignment.speakerId) ?? new Map<string, Deduped>()
    const received = item.assignment.status === 'received'
    const existing = forSpeaker.get(key)

    forSpeaker.set(key, {
      received: received || (existing?.received ?? false),
      title: titleOf(item, codeBySubmission),
      required: item.request.required,
    })
    bySpeaker.set(item.assignment.speakerId, forSpeaker)
  }

  return bySpeaker
}

/** The "has outstanding" filter, the same one the onboarding table offers. */
export function withMissingFiles(rows: readonly DeliveryRow[]): readonly DeliveryRow[] {
  return rows.filter((row) => row.outstanding > 0)
}

/** The one-line summary above the table. */
export function deliveryTotals(rows: readonly DeliveryRow[]): {
  speakers: number
  requested: number
  received: number
  complete: number
} {
  return {
    speakers: rows.length,
    requested: rows.reduce((total, row) => total + row.requested, 0),
    received: rows.reduce((total, row) => total + row.received, 0),
    // A speaker with nothing requested is not "complete": there is no document to have
    // delivered, and counting them would report a roster as collected before it was.
    complete: rows.filter((row) => row.requested > 0 && row.outstanding === 0).length,
  }
}
