'use client'

// The participant-facing copy, on steps 2, 3 and 4 (parity refs 07, 08, 10).
//
// One module for all three because the anatomy is identical and the parity doc transcribes
// it as one pattern: a 255-character title with a live counter, a 15-character page heading
// with the inline "(15 char max)" hint, and on steps 3 and 4 a required rich text
// "Description & Instructions". Its own file rather than three copies inside the steps,
// which are already near the file-size limit.
//
// Every value here is rendered by the public wizard: the external title heads the Welcome
// step, the page headings are the rail labels, and the two descriptions are the blocks above
// each step's questions. Nothing on this surface stores something nothing reads.

import { RichTextEditor } from '@/components/primitives/RichTextEditor'
import type { FormDraft } from '@/features/forms/builder/draft'
import { PAGE_HEADING_MAX, SECTION_TITLE_MAX } from '@/features/forms/builder/headings'

import { CountedInput } from './CountedInput'

/** Verbatim off refs 08 and 10, where it sits beside the Page Heading label. */
const HEADING_HINT = '(15 char max)'

export type WelcomeHeadingFieldsProps = {
  draft: FormDraft
  patch: (next: Partial<FormDraft>) => void
}

/** Step 2's two fields, under "Internal Form Name" and in that order. */
export function WelcomeHeadingFields({ draft, patch }: WelcomeHeadingFieldsProps) {
  return (
    <>
      <CountedInput
        id="external-form-title"
        label="External Form Title"
        value={draft.externalTitle}
        max={SECTION_TITLE_MAX}
        required
        placeholder="Welcome to our event!"
        onChange={(value) => patch({ externalTitle: value })}
      />
      <CountedInput
        id="welcome-heading"
        label="Page Heading"
        hint={HEADING_HINT}
        counter={false}
        value={draft.welcomeHeading}
        max={PAGE_HEADING_MAX}
        required
        placeholder="Welcome!"
        onChange={(value) => patch({ welcomeHeading: value })}
      />
    </>
  )
}

export type SectionHeadingFieldsProps = WelcomeHeadingFieldsProps & {
  kind: 'abstract' | 'participant'
}

/**
 * Steps 3 and 4's three fields. `kind` picks which set of columns they bind to, matching
 * how `StepQuestions` decides which question list it is editing.
 */
export function SectionHeadingFields({ draft, patch, kind }: SectionHeadingFieldsProps) {
  const participant = kind === 'participant'
  const title = participant ? draft.participantSectionTitle : draft.abstractSectionTitle
  const heading = participant ? draft.participantHeading : draft.abstractHeading
  const html = participant ? draft.participantSectionHtml : draft.abstractSectionHtml

  return (
    <>
      <CountedInput
        id={`${kind}-section-title`}
        label="Section Title"
        value={title}
        max={SECTION_TITLE_MAX}
        required
        placeholder={participant ? 'Tell us about you' : 'Tell us about your submission'}
        onChange={(value) =>
          patch(participant ? { participantSectionTitle: value } : { abstractSectionTitle: value })
        }
      />
      <CountedInput
        id={`${kind}-page-heading`}
        label="Page Heading"
        hint={HEADING_HINT}
        counter={false}
        value={heading}
        max={PAGE_HEADING_MAX}
        required
        placeholder={participant ? 'Participant' : 'Submission'}
        onChange={(value) =>
          patch(participant ? { participantHeading: value } : { abstractHeading: value })
        }
      />
      <RichTextEditor
        id={`${kind}-section-html`}
        label="Description & Instructions"
        required
        value={html}
        help="Shown above this step's questions on the public form."
        onChange={(next) =>
          patch(participant ? { participantSectionHtml: next } : { abstractSectionHtml: next })
        }
      />
    </>
  )
}
