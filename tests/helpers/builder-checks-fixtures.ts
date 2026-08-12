// The draft and the two questions every builder-check suite describes.
//
// Extracted when `builder-checks.test.ts` passed the file-size limit and the column-protection
// suites moved to `builder-column-checks.test.ts`. Both files describe the SAME form, so the
// fixture has to be one thing: a Format question, a conditional Lab question that depends on
// it, and a routing table that sends each format to a category.

import type { FormDraft } from '@/features/forms/builder/draft'
import { DEFAULT_FORM_HEADINGS } from '@/features/forms/builder/headings'
import type { FormField } from '@/types/forms'

/**
 * Bound to the library's Format field, the way every form in the seeded base binds it.
 *
 * It was UNBOUND here, which quietly made the shared fixture an example of the thing
 * `checkImpostorFields` now warns about: a select labelled Format whose answer would never
 * reach the format column. Harmless in a fixture and the CFP-15 finding in a real form, so
 * the fixture was the one that was wrong.
 */
export const FORMAT: FormField = {
  id: 'a',
  type: 'select',
  label: 'Format',
  required: true,
  registryKey: 'format',
  options: [
    { value: 'talk', label: 'Talk' },
    { value: 'workshop', label: 'Workshop' },
  ],
}

export const LAB: FormField = {
  id: 'b',
  type: 'text',
  label: 'Lab setup',
  required: true,
  showIf: { fieldId: 'a', op: 'eq', value: 'workshop' },
}

export const TRACKS = ['recInfra', 'recAgents', 'recProduct']
export const TAGS = ['recTagOne', 'recTagTwo']

/** A Track question bound to the library, offering whichever categories the caller names. */
export function trackField(values: readonly string[]): FormField {
  return {
    id: 'f_track',
    type: 'select',
    label: 'Track',
    required: false,
    registryKey: 'track',
    options: values.map((value) => ({ value, label: value })),
  }
}

export function messages(problems: readonly { message: string }[]): string {
  return problems.map((problem) => problem.message).join(' | ')
}

export function draft(overrides: Partial<FormDraft> = {}): FormDraft {
  return {
    // A complete form, headings included: `checkDraft` warns about an empty one, and
    // these tests are about the questions and the rules rather than the copy.
    ...DEFAULT_FORM_HEADINGS,
    name: 'Form',
    entityKind: 'abstracts',
    participantsEnabled: true,
    welcomeEnabled: false,
    welcomeHtml: '',
    successHtml: '',
    fields: [FORMAT, LAB],
    participantFields: [],
    routing: {
      rules: [
        { when: { fieldId: 'a', op: 'eq', value: 'workshop' }, trackId: 'recInfra' },
        { when: { fieldId: 'a', op: 'eq', value: 'talk' }, trackId: 'recAgents' },
      ],
      defaultTrackId: 'recProduct',
    },
    roles: [{ role: 'speaker', enabled: true, min: 1, max: 1 }],
    crossFieldLimits: [],
    closeDate: '',
    submissionLimitEnabled: false,
    submissionLimit: '',
    allowMultipleDrafts: false,
    autoRedirectToPortal: true,
    confirmationEmailEnabled: true,
    confirmationEmailHtml: '',
    adminAlertOnNew: [],
    adminAlertOnUpdate: [],
    ...overrides,
  }
}
