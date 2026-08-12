// The shape a public submit arrives in, parsed rather than trusted.
//
// A Server Action argument is an open POST: the wizard is one client, and anything
// that can reach the endpoint is another. Zod here answers only "is this the shape
// I can work with", which is a different question from "are these answers valid".
// Content validation is `@/features/forms/validate`, and it runs after this on the
// parsed object, because a validator that has to defend against `answers` being a
// string reports type confusion instead of the missing-title the speaker can fix.

import { z } from 'zod'
import { AppError, ErrorIds } from '@/constants/errorIds'
import { PARTICIPANT_ROLES } from '@/constants/status'

/**
 * Caps exist so a hostile payload cannot make the server do unbounded work before
 * validation rejects it. Generous rather than tight: the real limits are the form's
 * own `maxLen` and role maxima, enforced downstream with messages a speaker can act
 * on. 20 participants is well past any role maximum a builder can configure
 * (four roles, and the default maxima total five).
 */
const MAX_PARTICIPANTS = 20
const MAX_ANSWER_KEYS = 200

const answersSchema = z
  .record(z.string(), z.unknown())
  .refine((answers) => Object.keys(answers).length <= MAX_ANSWER_KEYS, {
    message: 'too many answers',
  })

const participantSchema = z.object({
  /** Client-side key, used to attribute problems to a row that has no record id yet. */
  key: z.string().min(1).max(64),
  role: z.enum(PARTICIPANT_ROLES),
  isPrimary: z.boolean(),
  email: z.string().max(320),
  firstName: z.string().max(255),
  lastName: z.string().max(255),
  answers: answersSchema,
})

export const submitPayloadSchema = z.object({
  /** The submitter, from the Account step. Becomes the primary Speakers row. */
  email: z.string().max(320),
  firstName: z.string().max(255),
  lastName: z.string().max(255),
  answers: answersSchema,
  participants: z.array(participantSchema).max(MAX_PARTICIPANTS),
})

export type SubmitPayload = z.infer<typeof submitPayloadSchema>
export type SubmitParticipant = SubmitPayload['participants'][number]

/**
 * Throws rather than returning a Result, and that is the one place in this feature
 * where throwing is right: a payload of the wrong shape did not come from the
 * wizard, so there is no control to attach a message to and nobody to read it.
 */
export function parseSubmitPayload(input: unknown): SubmitPayload {
  const parsed = submitPayloadSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'submission payload has the wrong shape', {
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`),
    })
  }
  return parsed.data
}
