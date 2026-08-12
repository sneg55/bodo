// What the Add Speaker sheet is holding, as one value.
//
// Split out of `AddSpeakerSheet.tsx` for the file-size limit, and the seam is the useful one:
// the sheet owns the two-press confirmation and the action call, `AddSpeakerFields` owns the
// six inputs, and this is the only thing they have to agree about.
//
// `statusTouched` is a field of the FORM rather than a detail of the select, because it is
// what the submit reads to decide whether to send `status` at all. The select always has a
// value, so "the organizer did not choose one" cannot be read off the value itself, and
// sending the default anyway is what silently demoted a Confirmed speaker to Prospect when
// they were re-added. See add-speaker-draft.ts.

import type { SpeakerStatus } from '@/constants/status'

export type AddSpeakerFormValues = {
  readonly name: string
  readonly email: string
  readonly company: string
  readonly tagline: string
  /** Plain text; converted to the stored HTML by `textToBioHtml` on the way out. */
  readonly bioText: string
  readonly status: SpeakerStatus
  /** True once the Status menu has been used. Until then the field is not sent. */
  readonly statusTouched: boolean
}

export const EMPTY_ADD_SPEAKER_FORM: AddSpeakerFormValues = {
  name: '',
  email: '',
  company: '',
  tagline: '',
  bioText: '',
  status: 'prospect',
  statusTouched: false,
}

/** The person an address already belongs to, once `addSpeakerAction` has said so. */
export type KnownSpeaker = {
  readonly name: string
  readonly status: SpeakerStatus
  /** The address it was answered for, so editing the email drops the confirmation. */
  readonly email: string
}
