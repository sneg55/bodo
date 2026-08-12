// Sessionboard's reads onto bodo's shapes. Pure. BUILD_SPEC 5.0e, Source B.
//
// This source carries email, so its speakers are portal-ready the moment the run
// finishes. That is not licence to fill a blank one in: a contact with no address on
// their side still lands with `email: ''` and on the Needs-email list, exactly as a
// Sessionize speaker does.

import {
  clean,
  mapRole,
  type NormalizedImport,
  type NormalizedParticipant,
  type NormalizedRef,
  type NormalizedSpeaker,
  type NormalizedSubmission,
  needsEmailFrom,
  registerRef,
  splitName,
} from '@/features/imports/normalize-shared'
import { mapSessionboardStatus } from '@/features/imports/status-map'
import type {
  SessionboardContact,
  SessionboardLookup,
  SessionboardSession,
} from '@/services/imports/sessionboard'

export type SessionboardPayload = {
  sessions: readonly SessionboardSession[]
  /** `/contacts` and `/speakers` both return Contacts; pass whichever the run read. */
  contacts: readonly SessionboardContact[]
  tracks?: readonly SessionboardLookup[]
  tags?: readonly SessionboardLookup[]
  rooms?: readonly SessionboardLookup[]
}

/** Collected while mapping, so one warning names every offending value rather than one
 * warning per row. A per-row warning list is unreadable on a 500-session event. */
type Unknowns = { roles: Set<string>; statuses: Set<string> }

function lookupRefs(rows: readonly SessionboardLookup[] | undefined): NormalizedRef[] {
  return (rows ?? []).map((row) => ({
    remoteId: row.id,
    name: clean(row.name) ?? '',
    order: row.sort_order ?? undefined,
  }))
}

function toParticipants(
  session: SessionboardSession,
  unknowns: Unknowns,
): readonly NormalizedParticipant[] {
  return session.participants.flatMap((participant, index) => {
    const speakerRemoteId = participant.contact_id ?? participant.contact?.id
    // A participant row with no contact behind it points at nothing bodo can create.
    if (speakerRemoteId === undefined) return []
    const isPrimary = participant.is_primary === true
    const role = mapRole(participant.role, isPrimary)
    if (!role.recognized) unknowns.roles.add((participant.role ?? '').trim())
    return [
      {
        speakerRemoteId,
        role: role.role,
        isPrimary,
        sortOrder: participant.sort_order ?? index,
      },
    ]
  })
}

function toSpeaker(contact: SessionboardContact): NormalizedSpeaker {
  const split = splitName(contact.full_name)
  return {
    remoteId: contact.id,
    email: clean(contact.email) ?? '',
    salutation: clean(contact.salutation),
    firstName: clean(contact.first_name) ?? split.firstName,
    lastName: clean(contact.last_name) ?? split.lastName,
    honorific: clean(contact.honorific),
    pronouns: clean(contact.pronouns),
    gender: clean(contact.gender),
    phone: clean(contact.phone_mobile),
    bio: clean(contact.about),
    tagline: clean(contact.title),
    company: clean(contact.company_name),
    headshotUrl: clean(contact.photo_url),
    links: {
      linkedin: clean(contact.linkedin_url),
      x: clean(contact.twitter_url),
      facebook: clean(contact.facebook_url),
      website: clean(contact.website_url),
    },
  }
}

export function normalizeSessionboard(payload: SessionboardPayload): NormalizedImport {
  const tracks = new Map(lookupRefs(payload.tracks).map((ref) => [ref.remoteId, ref]))
  const tags = new Map(lookupRefs(payload.tags).map((ref) => [ref.remoteId, ref]))
  const rooms = new Map(lookupRefs(payload.rooms).map((ref) => [ref.remoteId, ref]))
  const unknowns: Unknowns = { roles: new Set(), statuses: new Set() }

  const submissions = payload.sessions.map((session): NormalizedSubmission => {
    const mapped = mapSessionboardStatus(session.status)
    if (!mapped.recognized && clean(session.status) !== undefined) {
      unknowns.statuses.add((session.status ?? '').trim())
    }

    return {
      remoteId: session.id,
      title: clean(session.title) ?? '',
      description: clean(session.description),
      status: mapped.status,
      // `is_abstract` IS the reviewRequired split, straight from the source. An accepted
      // abstract and a program session share a status and differ only on this flag, so
      // inferring it from status would push every program session back through review.
      reviewRequired: session.is_abstract === true,
      format: clean(session.format?.name),
      level: clean(session.level?.name),
      language: clean(session.language?.name),
      trackRemoteId: registerRef(tracks, session.track),
      tagRemoteIds: session.tags.flatMap((tag) => registerRef(tags, tag) ?? []),
      roomRemoteId: registerRef(rooms, session.room),
      startsAt: clean(session.starts_at),
      endsAt: clean(session.ends_at),
      participants: toParticipants(session, unknowns),
    }
  })

  const warnings: string[] = []
  if (unknowns.roles.size > 0) {
    warnings.push(
      `Participant roles bodo has no equivalent for were imported as Speaker or Co-Speaker: ${[...unknowns.roles].join(', ')}.`,
    )
  }
  if (unknowns.statuses.size > 0) {
    warnings.push(
      `Session statuses bodo does not recognise were imported as Pending: ${[...unknowns.statuses].join(', ')}.`,
    )
  }

  const speakers = payload.contacts.map(toSpeaker)

  return {
    source: 'sessionboard',
    rooms: [...rooms.values()],
    tracks: [...tracks.values()],
    tags: [...tags.values()],
    speakers,
    submissions,
    agendaItems: [],
    needsEmail: needsEmailFrom(speakers),
    skipped: { speakers: 0, submissions: 0 },
    warnings,
  }
}
