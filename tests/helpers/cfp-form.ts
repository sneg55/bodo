// A CFP form and a submit payload, shared by the public-wizard tests.
//
// Deliberately shaped like the R1 acceptance criterion: one conditional field, two
// routing tracks, a registry-keyed question that belongs in a column and a local one
// that belongs in answersJson. Every assertion about storage or routing needs all four
// present at once, so they live in one fixture rather than being rebuilt per test.

import { isAppError } from '@/constants/errorIds'
import type { SubmitPayload } from '@/features/submissions/payload'
import type { PrepareResult } from '@/features/submissions/prepare'
import { prepareSubmission } from '@/features/submissions/prepare'
import type { Form, FormField } from '@/types/forms'

export const NOW = new Date('2026-08-08T12:00:00.000Z')

export const CFP_FIELDS: readonly FormField[] = [
  {
    id: 'f_title',
    type: 'text',
    label: 'Title',
    required: true,
    locked: true,
    registryKey: 'title',
  },
  {
    id: 'f_format',
    type: 'select',
    label: 'Format',
    required: true,
    registryKey: 'format',
    options: [
      { value: 'talk', label: 'Talk' },
      { value: 'workshop', label: 'Workshop' },
    ],
  },
  // The conditional field R1 requires, and the one whose answer must be stripped once
  // its condition stops holding.
  {
    id: 'f_lab',
    type: 'text',
    label: 'Lab setup requirements',
    required: true,
    showIf: { fieldId: 'f_format', op: 'eq', value: 'workshop' },
  },
  // No registryKey, so its answer belongs in answersJson rather than a column.
  { id: 'f_notes', type: 'text', label: 'Anything else', required: false },
]

export const CFP_PARTICIPANT_FIELDS: readonly FormField[] = [
  { id: 'p_first', type: 'text', label: 'First Name', required: true, locked: true },
  { id: 'p_last', type: 'text', label: 'Last Name', required: true, locked: true },
  { id: 'p_email', type: 'email', label: 'Email', required: true, locked: true },
  { id: 'p_bio', type: 'speaker_bio', label: 'Biography', required: false, maxLen: 5000 },
]

export const CFP_FORM: Form = {
  id: 'form1',
  eventId: 'ev1',
  name: 'Call for Speakers',
  publicId: 'pub1',
  kind: 'cfp',
  entityKind: 'abstracts',
  participantsEnabled: true,
  status: 'published',
  fields: CFP_FIELDS,
  participantFields: CFP_PARTICIPANT_FIELDS,
  routing: {
    rules: [
      { when: { fieldId: 'f_format', op: 'eq', value: 'workshop' }, trackId: 'trkWorkshop' },
      { when: { fieldId: 'f_format', op: 'eq', value: 'talk' }, trackId: 'trkTalk' },
    ],
    defaultTrackId: 'trkDefault',
  },
  roles: [
    { role: 'speaker', enabled: true, min: 1, max: 1 },
    { role: 'co_speaker', enabled: true, min: 0, max: 4 },
    { role: 'moderator', enabled: false, min: 0, max: 1 },
    { role: 'chairperson', enabled: false, min: 0, max: 1 },
  ],
  crossFieldLimits: [],
  closeDate: '2026-09-15T23:59:00.000Z',
  submissionLimit: 3,
  allowMultipleDrafts: false,
  autoRedirectToPortal: false,
  confirmationEmailEnabled: true,
  adminAlertOnNew: ['organizer@example.com'],
  adminAlertOnUpdate: [],
}

export function cfpPayload(overrides: Partial<SubmitPayload> = {}): SubmitPayload {
  return {
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Okafor',
    answers: { f_title: 'Agents that ship', f_format: 'talk', f_notes: 'Prefer the morning' },
    participants: [soloSpeaker()],
    ...overrides,
  }
}

export function soloSpeaker(
  overrides: Partial<SubmitPayload['participants'][number]> = {},
): SubmitPayload['participants'][number] {
  return {
    key: 'p1',
    role: 'speaker',
    isPrimary: true,
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Okafor',
    answers: {},
    ...overrides,
  }
}

export function prepareCfp(
  form: Form = CFP_FORM,
  input: Partial<SubmitPayload> = {},
  existingCount = 0,
): PrepareResult {
  return prepareSubmission({
    form,
    eventId: 'ev1',
    payload: cfpPayload(input),
    now: NOW,
    existingCount,
    limit: form.submissionLimit,
  })
}

/** The AppError id a refusal threw, so a test asserts the id rather than the message. */
export function thrownErrorId(run: () => unknown): string | undefined {
  try {
    run()
    return undefined
  } catch (error) {
    return isAppError(error) ? error.id : undefined
  }
}

/** Fails loudly with the problems, so an unexpected refusal says what was wrong. */
export function expectPrepared(result: PrepareResult) {
  if (!result.ok) {
    throw new Error(`unexpected problems: ${result.problems.map((p) => p.message).join('; ')}`)
  }
  return result.prepared
}
