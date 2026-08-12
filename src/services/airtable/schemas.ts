// Zod schemas for the JSON blob columns.
//
// Section 3 stores dynamic per-form answers, field definitions, roles, routing,
// criteria and rendered mail as JSON in long-text columns, because changing an
// Airtable schema through the API per form is not a trade worth making. The cost
// of that decision is that those columns are unvalidated text as far as Airtable
// is concerned, so the check has to happen here, once, at the read boundary.
//
// Each schema mirrors a type in src/types. They are deliberately not derived from
// each other: a mismatch should be a type error at the mapper, which is exactly
// the corruption these schemas exist to catch.

import { z } from 'zod'

import { PARTICIPANT_ROLES } from '@/constants/status'
import { FIELD_TYPES } from '@/types/forms'
import {
  PORTAL_CONTACT_TYPES,
  PORTAL_FILTER_FIELDS,
  PORTAL_FILTER_OPERATORS,
} from '@/types/portals'

/** `Submissions.answersJson`: form-specific answers keyed by field id. */
export const answersSchema = z.record(z.string(), z.unknown())

/** `Speakers.linksJson`. Unknown keys are dropped rather than rejected. */
export const speakerLinksSchema = z.object({
  linkedin: z.string().optional(),
  x: z.string().optional(),
  facebook: z.string().optional(),
  website: z.string().optional(),
})

const fieldConditionSchema = z.object({
  fieldId: z.string().min(1),
  op: z.enum(['eq', 'neq', 'in', 'answered']),
  value: z.union([z.string(), z.array(z.string())]).optional(),
})

const formFieldSchema = z.object({
  id: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  label: z.string(),
  /**
   * MUST be declared here or Zod strips it, and omitting it broke the whole CFP path
   * silently.
   *
   * §3 makes this key "the ONLY thing allowed to decide where its answer is stored", so
   * `splitAnswers` routes an answer to its typed column by this and nothing else. Zod
   * drops unknown keys by default, so a `fieldsJson` blob that carried
   * `registryKey: "title"` arrived with it deleted, every answer fell through to
   * `answersJson`, and `prepareSubmission` fell back to UNTITLED. A submission made
   * through the real form landed as "Untitled submission" with `format`, `level`,
   * `language`, `ceuCredits`, `trackId` and `tagIds` all empty, which also empties the
   * columns the Abstracts table sorts and filters on.
   *
   * Invisible to the unit tests because they build `FormField` objects in TypeScript,
   * where the key is present by construction; only a value that has round-tripped
   * through Airtable loses it. Found by submitting the deployed form.
   */
  registryKey: z.string().min(1).optional(),
  help: z.string().optional(),
  // Absent means not required. An older blob written before the flag existed
  // must not read as "required" and block a wizard nobody can get past.
  required: z.boolean().default(false),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  showIf: fieldConditionSchema.optional(),
  maxLen: z.number().int().positive().optional(),
  locked: z.boolean().optional(),
  mapsToSpeakerField: z.enum(['bio', 'headshotUrl']).optional(),
})

/** `Forms.fieldsJson` and `Forms.participantFieldsJson`. */
export const formFieldsSchema = z.array(formFieldSchema)

/** `Forms.rolesJson`: the participant roles panel from builder step 4. */
export const participantRolesSchema = z.array(
  z.object({
    role: z.enum(PARTICIPANT_ROLES),
    enabled: z.boolean().default(false),
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  }),
)

/** `Forms.routingJson`: track routing rules plus the no-match fallback. */
export const routingSchema = z.object({
  rules: z.array(z.object({ when: fieldConditionSchema, trackId: z.string().min(1) })).default([]),
  defaultTrackId: z.string().min(1).optional(),
})

/** `Forms.crossFieldLimitsJson`: a shared character budget across fields. */
export const crossFieldLimitsSchema = z.array(
  z.object({
    fieldIds: z.array(z.string().min(1)),
    maxLen: z.number().int().positive(),
    perParticipant: z.boolean().default(false),
  }),
)

/**
 * `Rounds.criteriaJson`: what a reviewer scores, and how heavily it counts.
 *
 * `kind` DEFAULTS to `numeric` rather than being required, and that default is what
 * lets the criterion kinds ship without a data migration: every rubric authored before
 * this column existed is a list of sliders, and that is exactly what it now reads as.
 */
export const criteriaSchema = z.array(
  z.object({
    key: z.string().min(1),
    label: z.string(),
    kind: z.enum(['numeric', 'select', 'text']).default('numeric'),
    min: z.number(),
    max: z.number(),
    weight: z.number(),
    options: z.array(z.object({ label: z.string(), value: z.number() })).optional(),
  }),
)

/** `Reviews.scoresJson`: criterion key to raw score, normalised by scoring.ts. */
export const scoresSchema = z.record(z.string(), z.number())

/**
 * `Portals.filterJson`: the contact types a portal targets, and the predicates it ANDs.
 *
 * The only schema in this file that ends in `.catch()` rather than failing the read, and the
 * asymmetry is the point. Everywhere else a corrupt blob refuses one screen: a form that
 * will not render, a review that will not open. This column is read by the portals LIST, by
 * the editor that is the only place a bad blob can be repaired, and by the assignment read
 * that decides which portal every contact lands in, so one row hand-edited in Airtable would
 * take all three down together and leave no route back to the control that fixes it.
 *
 * Whole-blob, never per rule. Dropping one malformed rule out of three silently WIDENS
 * membership whenever the dropped rule is an `is_not`, and a portal that quietly gained
 * people is exactly the failure this feature cannot see from the admin side. Losing the
 * whole set narrows to the empty set instead, and everyone it excludes falls through to the
 * default portal, which is where they were before the custom portal existed.
 *
 * Text that is not JSON at all still throws, because `jsonBlob` parses before it consults
 * the schema. That boundary is deliberate: unparseable means a corrupt WRITE, since the app
 * only ever stores `JSON.stringify` output, while a shape mismatch is the ordinary case of a
 * blob written by an older version of this file or typed by hand.
 */
export const portalFiltersSchema = z
  .object({
    // Empty means EVERY contact type (types/portals.ts), which is also what the default
    // portal carries, so a blob written before the type picker existed reads correctly.
    contactTypes: z.array(z.enum(PORTAL_CONTACT_TYPES)).default([]),
    rules: z
      .array(
        z.object({
          field: z.enum(PORTAL_FILTER_FIELDS),
          operator: z.enum(PORTAL_FILTER_OPERATORS),
          // An empty set matches NOTHING rather than everything (types/portals.ts), so a
          // half-built rule excludes from a custom portal instead of admitting everyone.
          values: z.array(z.string()).default([]),
        }),
      )
      .default([]),
  })
  // Spelled out rather than passing `EMPTY_PORTAL_FILTERS`, because `.catch()` is typed
  // against this schema's own mutable output while the exported constant is deeply
  // readonly. It is the same value, and the mapper hands the constant itself to `jsonBlob`
  // as the empty-column fallback, so both routes to "no filters" produce identical data.
  .catch({ contactTypes: [], rules: [] })

/** `Reviews.notesJson`: criterion key to the reviewer's prose for a `text` criterion. */
export const criterionNotesSchema = z.record(z.string(), z.string())

/** `EmailOutbox.payloadJson`: the message as it was rendered at enqueue time. */
export const outboxPayloadSchema = z.object({
  subject: z.string(),
  html: z.string(),
  attachIcs: z.boolean().default(false),
  /**
   * The slot a CANCELLATION refers to, snapshotted at enqueue.
   *
   * Everything else about an invite is read off the submission at send time, deliberately:
   * the room and time an invite states should be the ones that are true when it is sent.
   * A cancellation is the one case where that rule inverts. Unscheduling clears `startsAt`
   * and `endsAt` in the same write that triggers the cancel, so by the time the drain runs
   * there is nothing left to describe, and `inviteAttachments` raised MAIL_ICS_INVALID and
   * the row went `dead` on the first attempt. Measured, not reasoned: the sweep reported
   * `{"claimed":1,"sent":0,"dead":1}` and the speaker kept the session on their calendar.
   *
   * What a CANCEL has to name is the entry the client already holds, which is the LAST
   * slot that was sent, so snapshotting it here is both the fix and the correct semantics.
   */
  cancelledSlot: z
    .object({ startsAt: z.string(), endsAt: z.string(), room: z.string().optional() })
    .optional(),
})
