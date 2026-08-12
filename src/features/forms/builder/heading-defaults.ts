// Filling in the required participant-facing copy an old form never had.
//
// Split from headings.ts, which is at the size limit, and it is a clean seam: that file maps
// and CHECKS the eight authored strings, this one decides what stands in for an empty one.
//
// All eight carry a red asterisk off refs 07, 08 and 10. Only this makes the asterisk true.

import { DEFAULT_FORM_HEADINGS, type FormHeadings } from '@/features/forms/builder/headings'
import { blankToUndefined } from '@/features/forms/builder/text'

/** The three labels, named once each because they repeat down the table below. */
const EXTERNAL_TITLE = 'External Form Title'
const PAGE_HEADING = 'Page Heading'
const SECTION_TITLE = 'Section Title'
const DESCRIPTION = 'Description & Instructions'

/**
 * One authored heading and the default that stands in for it, for `fillEmptyHeadings`.
 *
 * A `read`/`fill` pair rather than a key, for the reason `HeadingRule` gives: a computed
 * index into an object trips `security/detect-object-injection`, which fails the build.
 */
type HeadingFill = {
  /** The builder's own label, so the organizer is told which control was filled in. */
  label: string
  /** Step 4's copy is not asked for when the form collects no participants. */
  participantStep?: boolean
  read: (headings: FormHeadings) => string
  fill: (headings: FormHeadings) => FormHeadings
}

const HEADING_FILLS: readonly HeadingFill[] = [
  {
    label: EXTERNAL_TITLE,
    read: (headings) => headings.externalTitle,
    fill: (headings) => ({ ...headings, externalTitle: DEFAULT_FORM_HEADINGS.externalTitle }),
  },
  {
    label: PAGE_HEADING,
    read: (headings) => headings.welcomeHeading,
    fill: (headings) => ({ ...headings, welcomeHeading: DEFAULT_FORM_HEADINGS.welcomeHeading }),
  },
  {
    label: SECTION_TITLE,
    read: (headings) => headings.abstractSectionTitle,
    fill: (headings) => ({
      ...headings,
      abstractSectionTitle: DEFAULT_FORM_HEADINGS.abstractSectionTitle,
    }),
  },
  {
    label: PAGE_HEADING,
    read: (headings) => headings.abstractHeading,
    fill: (headings) => ({ ...headings, abstractHeading: DEFAULT_FORM_HEADINGS.abstractHeading }),
  },
  {
    label: DESCRIPTION,
    read: (headings) => headings.abstractSectionHtml,
    fill: (headings) => ({
      ...headings,
      abstractSectionHtml: DEFAULT_FORM_HEADINGS.abstractSectionHtml,
    }),
  },
  {
    label: SECTION_TITLE,
    participantStep: true,
    read: (headings) => headings.participantSectionTitle,
    fill: (headings) => ({
      ...headings,
      participantSectionTitle: DEFAULT_FORM_HEADINGS.participantSectionTitle,
    }),
  },
  {
    label: PAGE_HEADING,
    participantStep: true,
    read: (headings) => headings.participantHeading,
    fill: (headings) => ({
      ...headings,
      participantHeading: DEFAULT_FORM_HEADINGS.participantHeading,
    }),
  },
  {
    label: DESCRIPTION,
    participantStep: true,
    read: (headings) => headings.participantSectionHtml,
    fill: (headings) => ({
      ...headings,
      participantSectionHtml: DEFAULT_FORM_HEADINGS.participantSectionHtml,
    }),
  },
]

/**
 * Just the eight authored strings, lifted out of whatever carries them.
 *
 * `FormDraft` extends `FormHeadings`, so the whole draft satisfies that type and
 * `fillEmptyHeadings` returns everything it was handed: called with a draft, it returned a
 * DRAFT, and the editor then merged that value back into its state. Any question added
 * between the render that produced the snapshot and the click that saved it was overwritten
 * by the older field list, on the save path, silently. Narrowing here means the merge can
 * only ever touch the eight keys it is about. Listed by hand rather than picked by a key
 * array, because a computed index into an object trips `security/detect-object-injection`.
 */
export function headingsOf(source: FormHeadings): FormHeadings {
  return {
    externalTitle: source.externalTitle,
    welcomeHeading: source.welcomeHeading,
    abstractSectionTitle: source.abstractSectionTitle,
    abstractHeading: source.abstractHeading,
    abstractSectionHtml: source.abstractSectionHtml,
    participantSectionTitle: source.participantSectionTitle,
    participantHeading: source.participantHeading,
    participantSectionHtml: source.participantSectionHtml,
  }
}

/**
 * Every empty required heading, filled with the wording the control already shows as its
 * PLACEHOLDER and the public wizard already falls back to.
 *
 * This is what makes the red asterisk on those eight controls true. All eight are marked
 * required off refs 07, 08 and 10, and on a form that predates these columns all eight are
 * empty, so `Save` reported "Saved successfully" over a form whose required fields were
 * still blank. Refusing the save instead was the other option and it is the wrong one: every
 * seeded form is in that state, so an error would lock an organizer out of saving anything
 * at all until they had retyped eight values they can already see in grey.
 *
 * Nothing the visitor sees changes, because these ARE the fallbacks. What changes is that
 * the form now holds what it claims to require, and the editor says which ones it filled.
 */
export function fillEmptyHeadings(
  headings: FormHeadings,
  participantsEnabled: boolean,
): { headings: FormHeadings; filled: readonly string[] } {
  let next = headings
  const filled = new Set<string>()

  for (const rule of HEADING_FILLS) {
    if (rule.participantStep === true && !participantsEnabled) continue
    // Through `blankToUndefined`, so a description emptied to TipTap's `<p></p>` counts as
    // empty here exactly as it does on the way to storage.
    if (blankToUndefined(rule.read(next).trim()) !== undefined) continue
    next = rule.fill(next)
    filled.add(rule.label)
  }

  return { headings: next, filled: [...filled] }
}
