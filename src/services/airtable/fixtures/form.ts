// The fixture CFP form. Split out of submissions.ts so both stay under the
// 300-line limit, and because the form is the interesting half: it is the one
// place the seeded library fields carry their `registryKey`.
//
// That key is what decides where an answer is stored. `format` and `title` come
// from the field registry, so their answers belong in first-class Airtable columns
// and are sortable in the Abstracts table. `fld_lab` has no key: it is a question
// this organizer invented, so it lands in `answersJson`. Nothing infers this from
// the label or the type, because a local select labelled "Format" is structurally
// identical to the registry's Format field.

import { DEFAULT_PARTICIPANT_ROLES } from '@/constants/status'
import type { Form } from '@/types/forms'

export const FIXTURE_FORM: Form = {
  id: 'fixForm1',
  eventId: 'fixEvent1',
  name: 'Call for Speakers 2026',
  publicId: 'cfp2026sandboxdemo01',
  kind: 'cfp',
  entityKind: 'abstracts',
  participantsEnabled: true,
  status: 'published',
  welcomeHtml: '<p>We are looking for talks about agents that actually ship.</p>',
  successHtml: '<p>Thanks. We will be in touch after review.</p>',
  fields: [
    {
      id: 'fld_title',
      type: 'text',
      label: 'Title',
      required: true,
      locked: true,
      maxLen: 255,
      registryKey: 'title',
    },
    {
      id: 'fld_desc',
      type: 'wysiwyg',
      label: 'Description',
      required: true,
      maxLen: 5000,
      // A registry field the registry marks `column: false`, so the answer still
      // goes to answersJson. Keyed anyway, so Library > Fields can find it.
      registryKey: 'description',
    },
    {
      id: 'fld_format',
      type: 'select',
      label: 'Format',
      required: true,
      // From the field library, so its answer writes to the Format column rather
      // than answersJson. fld_lab below has no key: it is a local question.
      registryKey: 'format',
      options: [
        { value: 'talk', label: 'Talk (30 min)' },
        { value: 'workshop', label: 'Workshop (90 min)' },
      ],
    },
    {
      // The conditional field the R1 acceptance criterion requires.
      id: 'fld_lab',
      type: 'text',
      label: 'Lab setup requirements',
      required: true,
      maxLen: 255,
      showIf: { fieldId: 'fld_format', op: 'eq', value: 'workshop' },
    },
  ],
  participantFields: [
    { id: 'fld_first', type: 'text', label: 'First Name', required: true, locked: true },
    { id: 'fld_last', type: 'text', label: 'Last Name', required: true, locked: true },
    { id: 'fld_email', type: 'email', label: 'Email', required: true, locked: true },
    { id: 'fld_bio', type: 'speaker_bio', label: 'Biography', required: false, maxLen: 5000 },
  ],
  routing: {
    rules: [
      { when: { fieldId: 'fld_format', op: 'eq', value: 'workshop' }, trackId: 'fixTrack3' },
      { when: { fieldId: 'fld_format', op: 'eq', value: 'talk' }, trackId: 'fixTrack1' },
    ],
    defaultTrackId: 'fixTrack4',
  },
  roles: DEFAULT_PARTICIPANT_ROLES,
  crossFieldLimits: [],
  closeDate: '2026-09-15T23:59:00.000Z',
  submissionLimit: 3,
  allowMultipleDrafts: false,
  autoRedirectToPortal: true,
  confirmationEmailEnabled: true,
  confirmationEmailHtml: '<p>We got your submission. Manage it in your portal.</p>',
  adminAlertOnNew: ['organizer@example.com'],
  adminAlertOnUpdate: [],
}
