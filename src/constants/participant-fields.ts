// The participant question set, seeded onto step 4 of a new abstract form.
//
// Split out of fields.ts only to keep both files under the 300-line limit; the
// registry API in fields.ts is still the single entry point everything reads.

import type { RegistryField } from '@/constants/fields'

export const PARTICIPANT_FIELDS: readonly RegistryField[] = [
  {
    key: 'firstName',
    label: 'First Name',
    type: 'text',
    group: 'participant',
    column: true,
    defaultVisible: true,
    locked: true,
    maxLen: 255,
  },
  {
    key: 'lastName',
    label: 'Last Name',
    type: 'text',
    group: 'participant',
    column: true,
    defaultVisible: true,
    locked: true,
    maxLen: 255,
  },
  {
    key: 'email',
    label: 'Email',
    type: 'email',
    group: 'participant',
    column: true,
    defaultVisible: true,
    locked: true,
  },
  {
    key: 'phone',
    label: 'Mobile Phone',
    type: 'phone',
    group: 'participant',
    column: true,
    defaultVisible: false,
  },
  {
    key: 'bio',
    label: 'Biography',
    type: 'speaker_bio',
    group: 'participant',
    column: true,
    defaultVisible: false,
    maxLen: 5000,
  },
  {
    key: 'company',
    label: 'Company',
    type: 'text',
    group: 'participant',
    column: true,
    defaultVisible: true,
    maxLen: 255,
  },
  {
    key: 'headshot',
    label: 'Headshot',
    type: 'speaker_headshot',
    group: 'participant',
    column: true,
    defaultVisible: false,
  },
]
