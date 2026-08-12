// The shapes every source normalises onto, and the helpers all three need. Pure.
//
// THE EMAIL RULE, and it is the most important line in the import. Sessionize's public
// speaker object has no email field. A speaker with no address lands with `email: ''`
// and is reported on the Needs-email list. No function in this directory composes an
// address out of a name, a domain, or an id, and none ever may: a synthesised
// `first.last@example.com` looks like data, passes every validation in this codebase,
// and produces a speaker whose magic link goes to a stranger.
//
// Remote ids stay remote ids here. The DAL resolves them to `RecordId`s when it writes,
// which is why `NeedsEmailRow` is completed afterwards rather than being built here.

import type { ParticipantRole, SubmissionStatus } from '@/constants/status'
import type { Speaker } from '@/types/domain'
import type { ImportSource, NeedsEmailRow } from '@/types/imports'

export type NormalizedRef = { remoteId: string; name: string; order?: number }
export type NormalizedSpeaker = Omit<Speaker, 'id'> & { remoteId: string }

export type NormalizedParticipant = {
  speakerRemoteId: string
  role: ParticipantRole
  isPrimary: boolean
  sortOrder: number
}

export type NormalizedSubmission = {
  remoteId: string
  title: string
  description?: string
  status: SubmissionStatus
  /** Taken from the source where the source states it. Never inferred from status. */
  reviewRequired: boolean
  format?: string
  level?: string
  language?: string
  trackRemoteId?: string
  tagRemoteIds: readonly string[]
  roomRemoteId?: string
  startsAt?: string
  endsAt?: string
  participants: readonly NormalizedParticipant[]
}

/** Agenda furniture: a placed row with no speaker and no submission behind it. */
export type NormalizedAgendaItem = {
  remoteId: string
  title: string
  roomRemoteId?: string
  startsAt?: string
  endsAt?: string
}

/** `NeedsEmailRow` without the local id, which does not exist until the DAL writes. */
export type PendingNeedsEmail = Omit<NeedsEmailRow, 'speakerId'>

export type NormalizedImport = {
  source: ImportSource
  rooms: readonly NormalizedRef[]
  tracks: readonly NormalizedRef[]
  tags: readonly NormalizedRef[]
  speakers: readonly NormalizedSpeaker[]
  submissions: readonly NormalizedSubmission[]
  agendaItems: readonly NormalizedAgendaItem[]
  needsEmail: readonly PendingNeedsEmail[]
  /** Round-trip skips, counted so the preview can name the number. */
  skipped: { speakers: number; submissions: number }
  /** Anything the organizer should know before pressing Import. Never a silent skip. */
  warnings: readonly string[]
}

export function clean(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? undefined : trimmed
}

export function splitName(full: string | null | undefined): {
  firstName: string
  lastName: string
} {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/** A reference with no id of its own is keyed by its name, so two tracks called `AI` on
 * the far side become one track here, which is what an organizer means by the name. */
export function refKey(id: string | null | undefined, name: string): string {
  return id ?? `name:${name.toLowerCase()}`
}

/** Registers a reference a settings list did not carry, returning its key. A track that
 * exists only on a session is still a track, and dropping it leaves the session
 * untracked, which reads on the agenda as a data-entry mistake nobody made. */
export function registerRef(
  target: Map<string, NormalizedRef>,
  ref: { id?: string | null; name?: string | null } | null | undefined,
): string | undefined {
  const name = clean(ref?.name)
  if (name === undefined) return undefined
  const key = refKey(ref?.id, name)
  if (!target.has(key)) target.set(key, { remoteId: key, name })
  return key
}

/** Position in the cast list is the only ordering Sessionize and Accelevents give. */
export function positionalParticipant(
  speakerRemoteId: string,
  index: number,
): NormalizedParticipant {
  return {
    speakerRemoteId,
    role: index === 0 ? 'speaker' : 'co_speaker',
    isPrimary: index === 0,
    sortOrder: index,
  }
}

const ROLE_ALIASES: ReadonlyMap<string, ParticipantRole> = new Map([
  ['speaker', 'speaker'],
  ['presenter', 'speaker'],
  ['primary_speaker', 'speaker'],
  ['co_speaker', 'co_speaker'],
  ['co-speaker', 'co_speaker'],
  ['cospeaker', 'co_speaker'],
  ['co speaker', 'co_speaker'],
  ['moderator', 'moderator'],
  ['chairperson', 'chairperson'],
  ['chair', 'chairperson'],
])

/**
 * Sessionboard's `participants` carries CUSTOM roles, which is most of why their own
 * document says to prefer it over the three legacy junction arrays. bodo has four roles,
 * so an unmapped custom role degrades to a bodo role AND is reported: dropping the
 * participant would lose a real person off a real session without saying so.
 */
export function mapRole(
  raw: string | null | undefined,
  isPrimary: boolean,
): { role: ParticipantRole; recognized: boolean } {
  const known = ROLE_ALIASES.get((raw ?? '').trim().toLowerCase())
  if (known !== undefined) return { role: known, recognized: true }
  // An absent role is not an unrecognised one: nothing to report, the default applies.
  return { role: isPrimary ? 'speaker' : 'co_speaker', recognized: clean(raw) === undefined }
}

/** Every speaker the run would create with no address. The list the organizer is owed. */
export function needsEmailFrom(
  speakers: readonly NormalizedSpeaker[],
): readonly PendingNeedsEmail[] {
  return speakers
    .filter((speaker) => speaker.email === '')
    .map((speaker) => ({
      name: `${speaker.firstName} ${speaker.lastName}`.trim(),
      remoteId: speaker.remoteId,
    }))
}
