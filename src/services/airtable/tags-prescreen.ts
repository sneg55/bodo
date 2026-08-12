// Cache tags for the AI pre-screen queue and its reviewer identity.
//
// A file of its own rather than two more lines in tags.ts, following tags-cms.ts and
// tags-dashboards.ts: three agents are in this directory at once and a shared file is
// where their edits collide. The vocabulary is the same shape as everything in tags.ts,
// which is what matters, because that shape is the contract between a read and the write
// that expires it.

import type { RecordId } from '@/types/domain'

/**
 * The event's pre-screen job rows: the progress line on the round, and its failure count.
 *
 * Separate from `event:{id}:review` even though a finished job also writes a review, and
 * the split is the point rather than an oversight. The progress line moves once per job
 * and the Ratings columns move once per review; sharing a tag would expire every Abstracts
 * table in the product each time one submission's job changed status, which is exactly the
 * granularity rule in BUILD_SPEC 6.1. The drain names BOTH tags, because a finished job
 * genuinely changes both.
 */
export const eventPrescreenTag = (eventId: RecordId): string => `event:${eventId}:prescreen`

/**
 * The `ai@system` AdminUsers row.
 *
 * Not event-scoped, because the row is not: one identity writes every event's AI reviews,
 * and it is looked up by email on a table that has no event link. It changes when the seed
 * runs and never again, so the read behind it takes the long window.
 */
export const aiReviewerTag = (): string => 'ai:reviewer'
