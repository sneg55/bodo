// The participant-facing copy the builder authors: one external title, three page
// headings, two section titles and two description blocks.
//
// Its own module rather than eight more keys in `draft.ts`, for the reason the note on
// `COL.externalTitle` gives: each is a plain string with its own cap that a counter
// renders, so they travel together and are mapped together. `draft.ts` intersects
// `FormHeadings` into `FormDraft`, so the editor binds to strings and the stored shape
// keeps absence.
//
// The two caps are transcribed, not chosen. A section title counts to 255 with a live
// counter; a page heading is capped at 15, because it is the public wizard's RAIL label
// rather than page copy. Ref 16 settles that: the live rail reads `Welcome!`, `Account`,
// `Submission`, `Participant`, `Review`, and `Welcome!` / `Submission` / `Participant` are
// exactly the three Page Heading values the builder screenshots show.

import type { BuilderProblem } from '@/features/forms/builder/problem'
import { blankToUndefined, trimToUndefined } from '@/features/forms/builder/text'
import type { Form, FormContent } from '@/types/forms'

/** Section Title and External Form Title: 255 with a live counter (refs 07, 08, 10). */
export const SECTION_TITLE_MAX = 255

/** Page Heading: the inline hint next to the label reads "(15 char max)". */
export const PAGE_HEADING_MAX = 15

/** The heading half of `FormDraft`: every value a control owns, so every value a string. */
export type FormHeadings = {
  externalTitle: string
  welcomeHeading: string
  abstractSectionTitle: string
  abstractHeading: string
  abstractSectionHtml: string
  participantSectionTitle: string
  participantHeading: string
  participantSectionHtml: string
}

/** The stored half: the same eight, where absent means absent. */
export type StoredHeadings = Pick<FormContent, keyof FormHeadings>

/**
 * What a new form opens with.
 *
 * Transcribed off refs 07, 08 and 10, the same precedent `DEFAULT_WELCOME_HTML` sets:
 * those are the product's own values for a freshly created form, and familiarity is
 * scored. Do not improve the wording.
 */
export const DEFAULT_FORM_HEADINGS: FormHeadings = {
  externalTitle: 'Welcome to our event!',
  welcomeHeading: 'Welcome!',
  abstractSectionTitle: 'Tell us about your submission',
  abstractHeading: 'Submission',
  abstractSectionHtml:
    '<p>What do you want to present? Fill out the following information to tell us more.</p>',
  participantSectionTitle: 'Tell us about you',
  participantHeading: 'Participant',
  participantSectionHtml:
    '<p>Give us information about yourself and your credentials for presenting at our event.</p>',
}

/**
 * All eight empty, which is what a PORTAL form has.
 *
 * A portal form deliberately has no participant-facing title: the heading a speaker reads
 * on a portal form is the task's own title, so the 3-step portal wizard never asks for one
 * and this is not a gap to be filled. Recorded in docs/parity/portal-tasks-forms.md.
 */
export const EMPTY_FORM_HEADINGS: FormHeadings = {
  externalTitle: '',
  welcomeHeading: '',
  abstractSectionTitle: '',
  abstractHeading: '',
  abstractSectionHtml: '',
  participantSectionTitle: '',
  participantHeading: '',
  participantSectionHtml: '',
}

export function headingsFromForm(form: Form): FormHeadings {
  return {
    externalTitle: form.externalTitle ?? '',
    welcomeHeading: form.welcomeHeading ?? '',
    abstractSectionTitle: form.abstractSectionTitle ?? '',
    abstractHeading: form.abstractHeading ?? '',
    abstractSectionHtml: form.abstractSectionHtml ?? '',
    participantSectionTitle: form.participantSectionTitle ?? '',
    participantHeading: form.participantHeading ?? '',
    participantSectionHtml: form.participantSectionHtml ?? '',
  }
}

/**
 * The stored shape. Titles and headings are trimmed; the two description bodies go
 * through `blankToUndefined`, so an editor emptied to `<p></p>` stores nothing and the
 * public step falls back instead of rendering an empty paragraph.
 */
export function headingsToWrite(headings: FormHeadings): StoredHeadings {
  return {
    externalTitle: trimToUndefined(headings.externalTitle),
    welcomeHeading: trimToUndefined(headings.welcomeHeading),
    abstractSectionTitle: trimToUndefined(headings.abstractSectionTitle),
    abstractHeading: trimToUndefined(headings.abstractHeading),
    abstractSectionHtml: blankToUndefined(headings.abstractSectionHtml),
    participantSectionTitle: trimToUndefined(headings.participantSectionTitle),
    participantHeading: trimToUndefined(headings.participantHeading),
    participantSectionHtml: blankToUndefined(headings.participantSectionHtml),
  }
}

/**
 * One authored heading, for `checkHeadings` and nothing else.
 *
 * `read` rather than a key, so nothing indexes the draft with a variable: a computed index
 * into an object trips `security/detect-object-injection`, which fails the build here.
 */
type HeadingRule = {
  /** The builder's own label, so a problem names what the organizer sees. */
  label: string
  /** Which wizard step to send them to. */
  step: number
  max: number
  read: (headings: FormHeadings) => string
}

const HEADING_RULES: readonly HeadingRule[] = [
  {
    label: 'External Form Title',
    step: 2,
    max: SECTION_TITLE_MAX,
    read: (headings) => headings.externalTitle,
  },
  {
    label: 'Page Heading',
    step: 2,
    max: PAGE_HEADING_MAX,
    read: (headings) => headings.welcomeHeading,
  },
  {
    label: 'Section Title',
    step: 3,
    max: SECTION_TITLE_MAX,
    read: (headings) => headings.abstractSectionTitle,
  },
  {
    label: 'Page Heading',
    step: 3,
    max: PAGE_HEADING_MAX,
    read: (headings) => headings.abstractHeading,
  },
  {
    label: 'Section Title',
    step: 4,
    max: SECTION_TITLE_MAX,
    read: (headings) => headings.participantSectionTitle,
  },
  {
    label: 'Page Heading',
    step: 4,
    max: PAGE_HEADING_MAX,
    read: (headings) => headings.participantHeading,
  },
]

/**
 * Whether the authored copy is storable and complete. Called by `checkDraft`.
 *
 * Two severities, and the split is deliberate. Over the cap is an ERROR, because the cap is
 * the product's and a 40-character rail label is not something the public wizard can render;
 * the inputs enforce `maxLength` so only a hand-built POST reaches it. Empty is a WARNING,
 * although the reference marks all six required, because every form created before these
 * columns existed has them empty: an error would refuse to save a form the organizer had
 * only opened, and the public wizard falls back per field rather than rendering a blank
 * heading. The organizer is told once per save and can leave it.
 */
export function checkHeadings(input: {
  headings: FormHeadings
  /** Step 4's two headings are not asked for when the form collects no participants. */
  participantsEnabled: boolean
  /**
   * Only a CFP form authors these. A portal form has no participant-facing title at all
   * (see EMPTY_FORM_HEADINGS), so warning about six empty fields it never offers a control
   * for would be six warnings on every portal form save.
   */
  authored: boolean
}): readonly BuilderProblem[] {
  if (!input.authored) return []
  const problems: BuilderProblem[] = []
  // Grouped by step, so a form that has none of this copy yet produces one warning per step
  // rather than six toasts saying the same thing about six inputs on three screens.
  const empty = new Map<number, string[]>()

  for (const rule of HEADING_RULES) {
    if (rule.step === 4 && !input.participantsEnabled) continue
    const value = rule.read(input.headings).trim()
    if (value.length === 0) {
      empty.set(rule.step, [...(empty.get(rule.step) ?? []), rule.label])
    } else if (value.length > rule.max) {
      problems.push({
        severity: 'error',
        step: rule.step,
        message: `${rule.label} is over its ${String(rule.max)} character limit.`,
      })
    }
  }

  for (const [step, labels] of empty) {
    problems.push({
      severity: 'warning',
      step,
      message: `${labels.join(' and ')} ${labels.length === 1 ? 'is' : 'are'} empty, so the public form falls back to its own wording.`,
    })
  }

  return problems
}
