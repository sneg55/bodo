// The words the filter editor and the review step put on the portal vocabularies.
//
// Split out of `PortalFilterEditor.tsx` because that file was over the 300-line budget with
// three lookup tables at the top of it, and because the review step needs the contact-type
// wording too and must not spell it a second way.
//
// Arrays of `{ value, label }` rather than `Record<Vocabulary, string>`, and `labelOf`
// rather than an index: `security/detect-object-injection` is an error in this project, and
// a lookup that silently returns `undefined` for a mistyped key is exactly the failure it
// exists to catch. A `find` that misses falls back to the raw value, which is visibly wrong
// on screen rather than blank.

import { PARTICIPANT_ROLE_LABELS } from '@/constants/status'
import type {
  PortalContactType,
  PortalFilterField,
  PortalFilterOperator,
  PortalKind,
} from '@/types/portals'

/** Vendor wording. The first four are the participant roles; `submitter` is the fifth type. */
export const CONTACT_TYPE_LABELS: readonly { value: PortalContactType; label: string }[] = [
  { value: 'speaker', label: PARTICIPANT_ROLE_LABELS.speaker },
  { value: 'co_speaker', label: PARTICIPANT_ROLE_LABELS.co_speaker },
  { value: 'moderator', label: PARTICIPANT_ROLE_LABELS.moderator },
  { value: 'chairperson', label: PARTICIPANT_ROLE_LABELS.chairperson },
  { value: 'submitter', label: 'Session Submitters' },
]

export const FILTER_FIELD_LABELS: readonly { value: PortalFilterField; label: string }[] = [
  { value: 'role', label: 'Role' },
  { value: 'company', label: 'Company' },
  { value: 'format', label: 'Format' },
  { value: 'track', label: 'Track' },
  { value: 'tag', label: 'Tag' },
  { value: 'level', label: 'Level' },
  { value: 'language', label: 'Language' },
]

export const FILTER_OPERATOR_LABELS: readonly { value: PortalFilterOperator; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
]

/**
 * The vendor's two portal kinds.
 *
 * `groups` is in the vocabulary because it is in the vendor's, and because the list screen
 * renders whatever a row actually carries rather than assuming. Nothing in this build
 * writes it: the sponsors and exhibitors module behind Groups Portals is on the waiver list.
 */
export const PORTAL_KIND_LABELS: readonly { value: PortalKind; label: string }[] = [
  { value: 'contacts', label: 'Contacts Portal' },
  { value: 'groups', label: 'Groups Portal' },
]

export function labelOf<T extends string>(
  table: readonly { value: T; label: string }[],
  value: T,
): string {
  return table.find((entry) => entry.value === value)?.label ?? value
}
