// What `Save` does about the eight required participant-facing strings.
//
// The run found "Section Title *" and "Description & Instructions *" empty on the seeded CFP
// form, with SAVE reporting "Saved successfully" over both: the asterisk was decorative. The
// asterisks are transcribed (refs 07, 08, 10) so they stay, and the save fills the empty ones
// with the wording their own placeholder shows. Refusing the save was the alternative and it
// is not available: every form created before these columns existed has all eight empty, so
// an error would lock an organizer out of saving anything until they retyped all of it.
//
// Pinned here because the filling is invisible on the public page by design, which is exactly
// what makes a regression in it hard to see: the wizard falls back to these same strings.

import { describe, expect, it } from 'vitest'

import { fillEmptyHeadings } from '@/features/forms/builder/heading-defaults'
import { DEFAULT_FORM_HEADINGS, EMPTY_FORM_HEADINGS } from '@/features/forms/builder/headings'

describe('fillEmptyHeadings', () => {
  it('fills all eight on a form that has none of them, and names three controls', () => {
    const { headings, filled } = fillEmptyHeadings(EMPTY_FORM_HEADINGS, true)

    expect(headings).toEqual(DEFAULT_FORM_HEADINGS)
    // One name per CONTROL, not per input: `Page Heading` is three of the eight.
    expect(filled).toEqual([
      'External Form Title',
      'Page Heading',
      'Section Title',
      'Description & Instructions',
    ])
  })

  it('changes nothing, and names nothing, once the copy is there', () => {
    const { headings, filled } = fillEmptyHeadings(DEFAULT_FORM_HEADINGS, true)

    expect(headings).toBe(DEFAULT_FORM_HEADINGS)
    expect(filled).toEqual([])
  })

  it('leaves the organizer’s own wording alone and fills only what is blank', () => {
    const authored = {
      ...EMPTY_FORM_HEADINGS,
      externalTitle: 'Speak at DeckLlama',
      abstractSectionHtml: '<p>Pitch us.</p>',
    }
    const { headings, filled } = fillEmptyHeadings(authored, true)

    expect(headings.externalTitle).toBe('Speak at DeckLlama')
    expect(headings.abstractSectionHtml).toBe('<p>Pitch us.</p>')
    expect(headings.abstractSectionTitle).toBe(DEFAULT_FORM_HEADINGS.abstractSectionTitle)
    expect(filled).not.toContain('External Form Title')
  })

  it('treats a description emptied to TipTap’s own empty paragraph as empty', () => {
    const { headings } = fillEmptyHeadings(
      { ...DEFAULT_FORM_HEADINGS, participantSectionHtml: '<p></p>' },
      true,
    )

    expect(headings.participantSectionHtml).toBe(DEFAULT_FORM_HEADINGS.participantSectionHtml)
  })

  it('treats a title of only whitespace as empty', () => {
    const { headings } = fillEmptyHeadings(
      { ...DEFAULT_FORM_HEADINGS, welcomeHeading: '   ' },
      true,
    )

    expect(headings.welcomeHeading).toBe('Welcome!')
  })

  it('leaves step 4 alone when the form collects no participants', () => {
    const { headings, filled } = fillEmptyHeadings(EMPTY_FORM_HEADINGS, false)

    expect(headings.participantSectionTitle).toBe('')
    expect(headings.participantHeading).toBe('')
    expect(headings.participantSectionHtml).toBe('')
    expect(headings.abstractSectionTitle).toBe(DEFAULT_FORM_HEADINGS.abstractSectionTitle)
    expect(filled).toContain('Description & Instructions')
  })
})
