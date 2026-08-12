// The section header's 255-character cap.
//
// The reference names the three layout tools inserted from the blue `+` between fields:
// `Section header` (255-character limit), `Form divider`, and `Rich text box`
// (docs/parity/external-references.md). This build authors one section header per step rather
// than one per position, as `Section Title`, and its cap was transcribed off our own screenshot
// as "26/255" before the reference existed. So the reference CORROBORATES the number, and this
// pins it: the cap is the product's, not a round number somebody liked.
//
// Two caps live side by side and are easy to swap by accident, which is the other reason this
// file exists. A `Page Heading` is capped at 15 because it is the public wizard's RAIL label
// (ref 16), and a section title is page copy. Our screenshots win on presentation, so the labels
// and the 15 stay as captured; the reference is used for behaviour only.

import { describe, expect, it } from 'vitest'

import {
  checkHeadings,
  DEFAULT_FORM_HEADINGS,
  type FormHeadings,
  PAGE_HEADING_MAX,
  SECTION_TITLE_MAX,
} from '@/features/forms/builder/headings'

function headings(over: Partial<FormHeadings>): FormHeadings {
  return { ...DEFAULT_FORM_HEADINGS, ...over }
}

function problems(over: Partial<FormHeadings>) {
  return checkHeadings({ headings: headings(over), participantsEnabled: true, authored: true })
}

function messages(over: Partial<FormHeadings>): readonly string[] {
  return problems(over).map((problem) => problem.message)
}

describe('the section header cap', () => {
  it('is 255, which is what the reference states for a Section header', () => {
    expect(SECTION_TITLE_MAX).toBe(255)
  })

  it('is not the page heading cap, which is 15 and a rail label', () => {
    expect(PAGE_HEADING_MAX).toBe(15)
  })

  it('accepts a section title of exactly 255 characters', () => {
    expect(messages({ abstractSectionTitle: 'x'.repeat(SECTION_TITLE_MAX) })).toEqual([])
  })

  it('refuses one character more, and says which limit was passed', () => {
    expect(messages({ abstractSectionTitle: 'x'.repeat(SECTION_TITLE_MAX + 1) })).toContain(
      'Section Title is over its 255 character limit.',
    )
  })

  it('refuses it as an error, since the public wizard cannot render what it cannot fit', () => {
    // The input enforces `maxLength`, so only a hand-built POST reaches this. It blocks the save
    // rather than warning, unlike an EMPTY heading, which every form created before these
    // columns existed has and which the public wizard falls back for.
    const over = problems({ participantSectionTitle: 'y'.repeat(400) })

    expect(over.every((problem) => problem.severity === 'error')).toBe(true)
  })

  it('counts the same cap on the step 4 section header as on step 3', () => {
    const both = messages({
      abstractSectionTitle: 'x'.repeat(256),
      participantSectionTitle: 'y'.repeat(256),
    })

    expect(both.filter((message) => message.includes('255 character limit')).length).toBe(2)
  })
})
