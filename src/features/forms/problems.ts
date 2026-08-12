// The vocabulary the two validate modules share, in its own file so neither has
// to import the other. Problems are values rather than exceptions because a
// filled-in form has to come back with every mistake at once, attributed to the
// control that caused it.

import { PARTICIPANT_ROLE_LABELS, type ParticipantRole } from '@/constants/status'
import type { FormAnswers } from '@/features/forms/logic'

/** Switchable by the UI, so no call site has to match on message text. */
export const ProblemCodes = {
  REQUIRED: 'required',
  /**
   * The answer is the wrong type or cardinality for the field: a checkbox that is
   * not a boolean, a multiselect that is not an array, a dropdown that is. Only
   * reachable from a payload the wizard did not build, so the message is a
   * fallback rather than copy a speaker is expected to act on.
   */
  SHAPE_INVALID: 'shape_invalid',
  MAX_LEN: 'max_len',
  OPTION_INVALID: 'option_invalid',
  EMAIL_INVALID: 'email_invalid',
  URL_INVALID: 'url_invalid',
  VIDEO_URL_INVALID: 'video_url_invalid',
  NUMBER_INVALID: 'number_invalid',
  ROLE_MIN: 'role_min',
  ROLE_MAX: 'role_max',
  ROLE_NOT_ENABLED: 'role_not_enabled',
  PRIMARY_MISSING: 'primary_missing',
  PRIMARY_DUPLICATE: 'primary_duplicate',
  CROSS_FIELD_MAX_LEN: 'cross_field_max_len',
} as const

export type ProblemCode = (typeof ProblemCodes)[keyof typeof ProblemCodes]

export type Problem = {
  fieldId?: string
  /** Set by a combined limit, which belongs to a set of controls rather than one. */
  fieldIds?: readonly string[]
  role?: ParticipantRole
  /** Client key while filling, record id once saved. */
  participantId?: string
  code: ProblemCode
  message: string
}

/**
 * Structurally satisfied by `SubmissionParticipant`, so the server can validate
 * saved rows while the wizard validates a cast that has no record ids yet.
 */
export type ParticipantInput = {
  role: ParticipantRole
  isPrimary: boolean
  id?: string
}

/** Per-participant answers for a `perParticipant` combined limit. */
export type ParticipantAnswers = {
  participantId?: string
  answers: FormAnswers
}

// Read through a Map because a dynamic index on a Record is a lint error here and
// reaches inherited keys.
const ROLE_LABELS: ReadonlyMap<ParticipantRole, string> = new Map(
  Object.entries(PARTICIPANT_ROLE_LABELS).map(([role, label]) => [role as ParticipantRole, label]),
)

export function roleLabel(role: ParticipantRole): string {
  return ROLE_LABELS.get(role) ?? role
}
