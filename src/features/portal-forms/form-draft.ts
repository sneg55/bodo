// What the 3-step portal form wizard holds, and the rules that gate its footer.
//
// The wizard is refs 27-29's: `Form Setup`, `Form Questions`, `Settings`, with `Next` disabled
// until the current step's required fields are complete and the helper line `Complete all
// required fields on this step to continue.` under it. Every label, placeholder, description
// and default in this file is transcribed off those three screenshots, so nothing here is to
// be improved: familiarity is scored, and the parity doc outranks BUILD_SPEC on copy.
//
// The draft itself is `FormDraft`, the same value the CFP builder edits, rather than a second
// shape. That is the point: `checkDraft`, `normalizeFields` and `toFormWrite` are already
// kind-agnostic, so a portal form is the same draft with `entityType` set, `participantsEnabled`
// off and no routing. A forked draft type would have meant a forked save path.
//
// Pure, and tested in tests/portal-forms-draft.test.ts.

import type { TaskEntityType } from '@/constants/status'
import type { BuilderProblem } from '@/features/forms/builder/checks'
import { checkDraft } from '@/features/forms/builder/checks'
import type { FormDraft } from '@/features/forms/builder/draft'
import { EMPTY_FORM_HEADINGS } from '@/features/forms/builder/headings'

/** Matches the cap the field registry puts on a title column, and the input counts to it. */
export const PORTAL_FORM_NAME_MAX = 255

export type PortalFormTypeCard = {
  entityType: TaskEntityType
  /** Ref 27's card labels, which are plural and audience-shaped. */
  label: string
  /** Ref 27's card descriptions, verbatim. */
  description: string
}

/**
 * **`Groups` IS GONE** (2026-08-10). Ref 27 renders it dimmed, and it was carried here dimmed
 * too, on the reading that the reference dims it as well. What that produced was a tile an
 * organizer can see, read a description of, and never pick, for an entity type that does not
 * exist anywhere in the build: BUILD_SPEC 3 has no Groups table, so it is not switched off
 * pending anything. A control with nothing behind it is deleted, not greyed, and this is the
 * same removal Exhibitors & Sponsors got on Event Settings (BUILD_SPEC 5.0b).
 *
 * The `GROUP FORMS` TAB on the list page stays, deliberately, and the distinction is
 * BUILD_SPEC 5.0b's own: a tab is one of four with a real count of 0, which is a true
 * statement about the data, while a picker tile is an offer that cannot be accepted.
 */
export const PORTAL_FORM_TYPE_CARDS: readonly PortalFormTypeCard[] = [
  {
    entityType: 'contact',
    label: 'Contacts',
    description: 'Collect contact information from people',
  },
  {
    entityType: 'submission',
    label: 'Submissions',
    description: 'Collect submission-related information',
  },
]

/** Ref 28's step 2 content, which is the default body a new form opens with. */
export const DEFAULT_PORTAL_WELCOME_HTML = '<p>Please add or update your information below.</p>'

/** Ref 29's confirmation body, verbatim, and the toggle above it is captured ON. */
export const DEFAULT_PORTAL_CONFIRMATION_HTML =
  '<p>Thank you for submitting your form. Here is a link to your submission.</p>'

/**
 * A new portal form's draft.
 *
 * `entityType: 'contact'` because ref 31's sibling drawer preselects `Contacts` and it is also
 * the only safe default: a contact form needs nothing but a speaker, so it cannot be created in
 * a state that would fan out to nobody.
 *
 * No seeded questions, unlike `newFormDraft`. A CFP form is seeded with the abstract set
 * because those answers write into typed `Submissions` columns and a form missing Title
 * produces untitled submissions. A portal form's answers all land in
 * `TaskAssignments.answersJson`, so there is no column for a seeded question to protect and
 * seeding one would put a question on the form that the organizer never asked for.
 */
export function newPortalFormDraft(name = ''): FormDraft {
  return {
    // All eight empty, and that is the recorded decision rather than an omission: a portal
    // form has no participant-facing title, because the heading a speaker reads on one is
    // the task's own title. See the note on EMPTY_FORM_HEADINGS.
    ...EMPTY_FORM_HEADINGS,
    name,
    // Unused by a portal form and not nullable on `Form`. `abstracts` is the value
    // `mapForm` defaults a blank column to, so writing it keeps the read and the write in
    // agreement rather than storing something the mapper would not have produced.
    entityKind: 'abstracts',
    entityType: 'contact',
    // A portal form is answered by a speaker who is already a record, so there is nobody to
    // collect participant contact details for. Off means `toFormWrite` drops the step's
    // questions and `checkDraft` skips its role rules entirely.
    participantsEnabled: false,
    welcomeEnabled: true,
    welcomeHtml: DEFAULT_PORTAL_WELCOME_HTML,
    successHtml: '',
    fields: [],
    participantFields: [],
    routing: { rules: [], defaultTrackId: undefined },
    roles: [],
    crossFieldLimits: [],
    closeDate: '',
    submissionLimitEnabled: false,
    submissionLimit: '',
    allowMultipleDrafts: false,
    autoRedirectToPortal: false,
    confirmationEmailEnabled: true,
    confirmationEmailHtml: DEFAULT_PORTAL_CONFIRMATION_HTML,
    adminAlertOnNew: [],
    adminAlertOnUpdate: [],
  }
}

/**
 * Whether one step's required fields are complete, which is what enables `Next` and hides
 * the helper line under the footer (ref 27).
 *
 * Step 2 requires at least one question, and that is a deliberate reading of "required
 * fields on this step" rather than a transcription: a portal form with no questions renders
 * in the portal as a to-do with nothing to fill in and a Complete button that stores an
 * empty answer set, which is the "looks real and does nothing" failure. Step 3 has no
 * required field, so it is always complete.
 */
export function isPortalStepComplete(draft: FormDraft, step: number): boolean {
  if (step === 1) {
    return draft.name.trim().length > 0 && draft.entityType !== undefined
  }
  if (step === 2) return draft.fields.length > 0
  return true
}

/** Verbatim off ref 27's footer, shown while the current step is incomplete. */
export const STEP_INCOMPLETE_HELP = 'Complete all required fields on this step to continue.'

/**
 * The whole draft, checked.
 *
 * `checkDraft` does the work, because every rule it encodes applies here unchanged: a choice
 * question with no options is unanswerable on a portal form too, and a `showIf` whose
 * controller sits below it is the same broken rule. It is reused rather than copied for the
 * reason its own header gives: `visibleFields` is deliberately forgiving about a dangling or
 * out-of-order condition, so the builder has to be strict or the speaker is silently never
 * shown the question.
 *
 * The two additions are what only a portal form has. `Type` is an ERROR, because it is a
 * required field on step 1 and the fan-out cannot decide whether a to-do hangs off a person or
 * a session without it. Having no questions is a WARNING, not an error, and the split follows
 * this builder's own stated policy: Save refuses on an error and stores on a warning so a form
 * can be left half-built. A form with no questions is exactly half-built, and the hard refusal
 * belongs at the moment it would reach a speaker, which is `portalFormAssignBlocker`.
 *
 * The `step` numbers `checkDraft` stamps are the CFP wizard's, not this one's, and nothing
 * reads them: the save action reports `message` and `severity` only. Left alone rather than
 * remapped, so this composes over `checkDraft` instead of reaching into it.
 */
export function checkPortalFormDraft(
  draft: FormDraft,
  trackIds: readonly string[] = [],
  tagIds: readonly string[] = [],
): readonly BuilderProblem[] {
  const problems: BuilderProblem[] = []
  if (draft.entityType === undefined) {
    problems.push({ severity: 'error', step: 1, message: 'Choose what type of form this is.' })
  }
  if (draft.fields.length === 0) {
    problems.push({
      severity: 'warning',
      step: 2,
      message: 'This form has no questions yet, so it cannot be assigned to anybody.',
    })
  }
  // `false`: a portal form's answers go to `TaskAssignments.answersJson` and never reach a
  // typed link column, so a Track or Tags option value is inert text here. Passing `true`
  // rejected every such question, because these callers have no event track list to hand.
  return [...problems, ...checkDraft(draft, trackIds, tagIds, false)]
}
