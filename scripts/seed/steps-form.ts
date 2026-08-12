// Step two: the published CFP form.
//
// Two things here are load-bearing rather than decorative.
//
// `registryKey` is stamped on every library field. It is the ONLY thing allowed to
// decide where an answer is stored (BUILD_SPEC section 3), and a seeded Format
// question with no key would put its answer in `answersJson`, which silently costs
// the Abstracts table a sortable column. Nothing infers it from the label or the
// type, because `fld_lab` below is structurally identical to a library field and
// deliberately has no key: it is a question this organizer invented.
//
// `routingJson` carries real Airtable record ids, which is why it is built here from
// the ids step one produced rather than declared as data. A routing rule pointing at
// a track id that does not exist routes every matching submission to nothing.

import { DEFAULT_PARTICIPANT_ROLES } from '@/constants/status'
import { COL, TABLES } from '@/services/airtable/tables'
import { link } from '@/services/airtable/to-fields'
import type { FormField, RoutingConfig } from '@/types/forms'
import type { Ensured, SeedContext } from './ensure'
import { idFor, idOf } from './ensure'
import { ADMINS, FORM, TRACKS } from './scenario'
import type { Foundation } from './steps-foundation'

const FIELDS: readonly FormField[] = [
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
    // Keyed, but the registry marks Description `column: false`, so the answer still
    // lands in answersJson. The key is what lets Library > Fields find it.
    registryKey: 'description',
  },
  {
    id: 'fld_format',
    type: 'select',
    label: 'Format',
    required: true,
    registryKey: 'format',
    options: [
      { value: 'talk', label: 'Talk (30 min)' },
      { value: 'workshop', label: 'Workshop (90 min)' },
    ],
  },
  {
    // The one conditional field the R1 acceptance criterion asks for. No registryKey,
    // on purpose: a local question, so its answer belongs in answersJson.
    id: 'fld_lab',
    type: 'text',
    label: 'Lab setup requirements',
    required: true,
    maxLen: 255,
    showIf: { fieldId: 'fld_format', op: 'eq', value: 'workshop' },
  },
]

const PARTICIPANT_FIELDS: readonly FormField[] = [
  { id: 'fld_first', type: 'text', label: 'First Name', required: true, locked: true },
  { id: 'fld_last', type: 'text', label: 'Last Name', required: true, locked: true },
  { id: 'fld_email', type: 'email', label: 'Email', required: true, locked: true },
  { id: 'fld_bio', type: 'speaker_bio', label: 'Biography', required: false, maxLen: 5000 },
]

/** Two rules plus a fallback, so every submitted abstract lands on some track. */
function routing(tracks: Ensured, eventId: string): RoutingConfig {
  const trackId = (name: string): string => idFor(tracks, [link(eventId), name], 'track')

  return {
    rules: [
      {
        when: { fieldId: 'fld_format', op: 'eq', value: 'workshop' },
        trackId: trackId(TRACKS.infra),
      },
      { when: { fieldId: 'fld_format', op: 'eq', value: 'talk' }, trackId: trackId(TRACKS.agents) },
    ],
    defaultTrackId: trackId(TRACKS.product),
  }
}

export async function seedForm({ ensure }: SeedContext, foundation: Foundation): Promise<string> {
  const forms = await ensure(
    TABLES.forms,
    [COL.publicId],
    [
      {
        [COL.name]: FORM.name,
        [COL.event]: link(foundation.eventId),
        [COL.publicId]: FORM.publicId,
        [COL.kind]: 'cfp',
        [COL.entityKind]: 'abstracts',
        [COL.participantsEnabled]: true,
        [COL.status]: 'published',
        [COL.welcomeHtml]: '<p>We are looking for talks about agents that actually ship.</p>',
        [COL.successHtml]: '<p>Thanks. We will be in touch after review.</p>',
        [COL.fieldsJson]: JSON.stringify(FIELDS),
        [COL.participantFieldsJson]: JSON.stringify(PARTICIPANT_FIELDS),
        [COL.routingJson]: JSON.stringify(routing(foundation.tracks, foundation.eventId)),
        [COL.rolesJson]: JSON.stringify(DEFAULT_PARTICIPANT_ROLES),
        [COL.crossFieldLimitsJson]: JSON.stringify([]),
        [COL.closeDate]: FORM.closeDate,
        [COL.submissionLimit]: 3,
        [COL.allowMultipleDrafts]: false,
        [COL.autoRedirectToPortal]: true,
        [COL.confirmationEmailEnabled]: true,
        [COL.confirmationEmailHtml]: '<p>We got your submission. Manage it in your portal.</p>',
        // `ADMINS.organizer`, not a literal. It was spelled `organizer@example.com` here
        // while every other seeded address went through `SEED_EMAIL_DOMAIN`, so seeding a
        // base against a real domain still pointed the new-submission alert at a domain
        // Resend refuses by name: every submission through the seeded form queued an alert
        // that could never be delivered.
        [COL.adminAlertOnNew]: ADMINS.organizer,
      },
    ],
  )
  return idOf(forms, FORM.publicId, 'form')
}
