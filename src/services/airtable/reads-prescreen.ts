// Reads for the AI pre-screen: the job queue, the AI reviewer's identity, and the two
// records the drain needs per job.
//
// The split between cached and uncached here is the same one `reads-review.ts` draws at
// its bottom three functions, and it matters for the same reason. The progress line is a
// screen, so it reads through the tag; the drain decides between "run this" and "skip it"
// from what it reads, so a cached answer there would score one submission twice.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { type PrescreenSubmission, toPrescreenSubmission } from '@/features/jobs/prescreen-rubric'
import { getClient } from '@/services/airtable/client'
import { FIXTURE_ADMINS } from '@/services/airtable/fixtures'
import { mapSubmission } from '@/services/airtable/mapping'
import { mapAdminUser, mapRound } from '@/services/airtable/mapping-lookups'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import {
  type AirtableRecord,
  checkbox,
  numberOr,
  optionalText,
  requiredChoice,
  requiredLink,
  view,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { aiReviewerTag, eventPrescreenTag } from '@/services/airtable/tags-prescreen'
import type { RecordId, Round } from '@/types/domain'
import { AI_PRESCREEN_STATUSES, AI_REVIEWER_EMAIL, type AiPrescreenJob } from '@/types/prescreen'
import { hasAirtable } from '@/utils/env'

export function mapPrescreenJob(record: AirtableRecord): AiPrescreenJob {
  const source = view(TABLES.aiPrescreenJobs, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    roundId: requiredLink(source, COL.round),
    submissionId: requiredLink(source, COL.submission),
    status: requiredChoice(source, COL.status, AI_PRESCREEN_STATUSES),
    // Zero rather than an error for a row somebody created in Airtable by hand: an
    // absent count means "not attempted yet", which is the only thing it can mean.
    attempts: numberOr(source, COL.attempts, 0),
    // False for an absent checkbox, which is what Airtable returns for one nobody has
    // ticked, and the only thing it can mean: the sample did not write this row.
    mocked: checkbox(source, COL.mocked),
    error: optionalText(source, COL.error),
    queuedAt: optionalText(source, COL.queuedAt) ?? '',
    startedAt: optionalText(source, COL.startedAt),
    finishedAt: optionalText(source, COL.finishedAt),
  }
}

/**
 * The event's jobs, for the progress line. Filtered in code rather than by formula,
 * per BUILD_SPEC 3.1: the link column holds an array and a formula over it is the
 * fragile half of this DAL.
 */
export async function listPrescreenJobs(eventId: RecordId): Promise<readonly AiPrescreenJob[]> {
  if (!hasAirtable()) return []

  const cache: ReadCache = {
    tags: [eventPrescreenTag(eventId)],
    revalidate: REVALIDATE.edited,
  }
  const records = await getClient().listAll(TABLES.aiPrescreenJobs, cache)
  return records.map(mapPrescreenJob).filter((job) => job.eventId === eventId)
}

/**
 * The event's jobs, uncached, for the press that decides what to queue.
 *
 * The enqueue decides create-vs-skip from this list, which is the same reason the round
 * entry in mutations-review.ts reads uncached: a cached list is missing whatever was added
 * since it was populated, and deciding to create from it is how one submission ends up with
 * two rows. It matters here even though the enqueue holds a claim on the round, because the
 * lease is fixed: a press releases the round once its writes land, but a throttled press can
 * still outlive its own lease, and the second holder that arrives after it must at least
 * read the winner's rows rather than the list that predates them. See
 * `PRESCREEN_ENQUEUE_LEASE_MS`.
 *
 * The progress line keeps reading through `listPrescreenJobs`: a screen wants the cached
 * answer, and every write that changes it expires `event:{id}:prescreen`.
 */
export async function listPrescreenJobsUncached(
  eventId: RecordId,
): Promise<readonly AiPrescreenJob[]> {
  const records = await getClient().listAll(TABLES.aiPrescreenJobs)
  return records.map(mapPrescreenJob).filter((job) => job.eventId === eventId)
}

/**
 * Every job, uncached, for the drain.
 *
 * No event filter and no status filter: the tick claims what it can run and the claim is
 * what makes overlap safe, so narrowing here would only mean a second list call the moment
 * a second event starts a pre-screen.
 */
export async function listPrescreenJobsForDrain(): Promise<readonly AiPrescreenJob[]> {
  return (await getClient().listAll(TABLES.aiPrescreenJobs)).map(mapPrescreenJob)
}

/**
 * The AdminUsers row every AI review is written under.
 *
 * A hard failure when it is missing, rather than creating it on the fly. Creating it would
 * mean a write on a read path and, worse, a race that ends with two `ai@system` rows and
 * two reviewer identities for one reviewer, which nothing downstream could reconcile. It
 * is a seed row; the message says so.
 */
export async function getAiReviewerId(): Promise<RecordId> {
  if (!hasAirtable()) {
    const fixture = FIXTURE_ADMINS.find((admin) => admin.email === AI_REVIEWER_EMAIL)
    if (fixture !== undefined) return fixture.id
  }

  const records = await getClient().listAll(TABLES.adminUsers, {
    tags: [aiReviewerTag()],
    revalidate: REVALIDATE.lookup,
  })
  const found = records.map(mapAdminUser).find((admin) => admin.email === AI_REVIEWER_EMAIL)
  if (found === undefined) {
    throw new AppError(
      ErrorIds.DATA_RECORD_NOT_FOUND,
      `no AdminUsers row for ${AI_REVIEWER_EMAIL}; run \`npm run seed\` to create the AI reviewer`,
      { email: AI_REVIEWER_EMAIL },
    )
  }
  return found.id
}

/**
 * One round by id, uncached, because the drain reads it to decide what rubric a review is
 * scored against and a stale rubric writes scores for criteria the round no longer has.
 */
export async function getRoundForPrescreen(roundId: RecordId): Promise<Round> {
  return mapRound(await getClient().getRecord(TABLES.rounds, roundId))
}

/** One submission, reduced to what the model is shown. Uncached, same reasoning. */
export async function getPrescreenSubmission(submissionId: RecordId): Promise<PrescreenSubmission> {
  return toPrescreenSubmission(
    mapSubmission(await getClient().getRecord(TABLES.submissions, submissionId)),
  )
}
