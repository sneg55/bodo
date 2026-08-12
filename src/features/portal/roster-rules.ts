// What a speaker may do to a submission's cast, as pure functions.
//
// Pure because every interesting case here is a combination (a co-speaker on a form whose
// co-speaker maximum is already met, a removal of the last row, a removal of the primary,
// a role the organizer disabled after the submission was filed) and each is one line to
// assert and a long trip through two browser sessions to reproduce.
//
// The two refusals that are not preferences:
//
//   - THE PRIMARY CANNOT BE REMOVED. `draftsOf` in reminders-wiring.ts drops a draft with
//     no participant row, so a draft whose cast was emptied is one nobody is ever nudged
//     about before the form closes; and `SUB_NO_RECIPIENTS` in decision-preview.ts is what
//     a decision hits when a submission has nobody to notify. Removing the submitter turns
//     a live submission into one the organizer cannot reach.
//   - A DUPLICATE IS REFUSED, not merged. Two rows for one speaker on one submission make
//     the roster count wrong, the role rules wrong, and `ownSubmissions` return the same
//     submission twice.

import { PARTICIPANT_ROLE_LABELS, type ParticipantRole } from '@/constants/status'
import type { Problem } from '@/features/forms/validate'
import { ProblemCodes, validateParticipants } from '@/features/forms/validate'
import type { EditPermission } from '@/features/portal/edit-mode'
import type { ParticipantRoleRule } from '@/types/forms'

/** Loose, and the same shape the wizard's Account step and `identityProblems` use. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** One existing row, reduced to what a rule can decide from. */
export type RosterMember = {
  id: string
  speakerId: string
  email: string
  role: ParticipantRole
  isPrimary: boolean
}

/**
 * Whether the roster may be changed at all.
 *
 * Deliberately the SAME flag that decides whether the answers are a form or text, rather
 * than a second policy: the cast is part of the submission's content, so a submission
 * whose body is frozen has a frozen cast too. That is what keeps CFP-16 passing (a form
 * past its close date yields `body_locked`, so no control renders and the action refuses)
 * and it means a draft and a still-editable pending submission both allow it.
 */
export function rosterEditable(permission: EditPermission): boolean {
  return permission.bodyEditable
}

/** The roles this form offers, for the Add control's picker. */
export function assignableRoles(
  roles: readonly ParticipantRoleRule[],
): readonly { role: ParticipantRole; label: string }[] {
  return roles
    .filter((rule) => rule.enabled)
    .map((rule) => ({ role: rule.role, label: roleLabelOf(rule.role) }))
}

function roleLabelOf(role: ParticipantRole): string {
  // A Map lookup, because indexing a plain object with a variable is what
  // `security/detect-object-injection` exists to stop and that warning fails the build.
  return LABELS.get(role) ?? role
}

const LABELS: ReadonlyMap<ParticipantRole, string> = new Map(
  Object.entries(PARTICIPANT_ROLE_LABELS).map(([role, label]) => [role as ParticipantRole, label]),
)

export type AdditionInput = {
  roster: readonly RosterMember[]
  roles: readonly ParticipantRoleRule[]
  email: string
  role: ParticipantRole
}

/**
 * Why this person cannot be added, or nothing.
 *
 * Role limits come from `validateParticipants`, the same function the public wizard and
 * `prepareSubmission` use, run against the roster AS IT WOULD BE. A second implementation
 * here would eventually disagree with the wizard about the same form, and the failure mode
 * is a portal that accepts a cast the submit path would refuse.
 *
 * Only the problems the ADDITION causes are reported. A form whose co-speaker minimum is
 * two is already unmet before the press, and reporting that as a reason the add failed
 * would be a refusal the speaker cannot act on by pressing a different button.
 */
export function additionProblems(input: AdditionInput): readonly Problem[] {
  const email = input.email.trim().toLowerCase()
  if (email.length === 0) {
    return [{ code: ProblemCodes.REQUIRED, message: 'An email address is required.' }]
  }
  if (!EMAIL_SHAPE.test(email)) {
    return [
      { code: ProblemCodes.EMAIL_INVALID, message: `${input.email} is not a valid email address.` },
    ]
  }
  if (input.roster.some((member) => member.email.trim().toLowerCase() === email)) {
    return [
      {
        code: ProblemCodes.SHAPE_INVALID,
        message: 'That person is already on this submission.',
      },
    ]
  }

  const before = validateParticipants(input.roles, input.roster)
  const after = validateParticipants(input.roles, [
    ...input.roster,
    { role: input.role, isPrimary: false },
  ])
  return onlyNew(before, after)
}

/** Why this row cannot be removed, or nothing. */
export function removalProblems(
  roster: readonly RosterMember[],
  participantId: string,
): readonly Problem[] {
  const member = roster.find((row) => row.id === participantId)
  if (member === undefined) {
    return [{ code: ProblemCodes.SHAPE_INVALID, message: 'That person is not on this submission.' }]
  }
  if (member.isPrimary) {
    return [
      {
        code: ProblemCodes.PRIMARY_MISSING,
        message:
          'The submitter cannot be removed from their own submission. Withdraw it instead if it should not go ahead.',
      },
    ]
  }
  if (roster.length <= 1) {
    return [
      {
        code: ProblemCodes.ROLE_MIN,
        message: 'A submission needs at least one participant.',
      },
    ]
  }
  return []
}

/**
 * Problems the change introduced, so a pre-existing one is not reported as a consequence
 * of the press.
 *
 * Keyed on CODE AND ROLE, not on the message, and that distinction is the whole function.
 * `validateParticipants` writes the running count into the text, so "Add at least 2
 * Co-Speaker (0 added)" becomes "(1 added)" the moment somebody is added: a message-keyed
 * diff sees a brand new problem and refuses the first of the two adds the rule is asking
 * for, making the requirement impossible to satisfy. Two problems are the same problem
 * when they are the same rule about the same role.
 */
function onlyNew(before: readonly Problem[], after: readonly Problem[]): readonly Problem[] {
  const key = (problem: Problem): string => `${problem.code}|${problem.role ?? ''}`
  const known = new Set(before.map(key))
  return after.filter((problem) => !known.has(key(problem)))
}
