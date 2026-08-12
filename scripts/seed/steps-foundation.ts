// Step one: the event and everything a submission needs to point at.
//
// Order matters here and only here: a track cannot link to an event that does not
// exist yet, so this runs before anything else and hands its ids down. Later steps
// are independent of each other.

import { EVENT_ROLES } from '@/constants/status'
import type { FieldSet } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { link, speakerFields } from '@/services/airtable/to-fields'
import type { Ensured, SeedContext } from './ensure'
import { idFor } from './ensure'
import { ADMINS, AI_REVIEWER, EVENT, ROOMS, SPEAKERS, TAGS, TRACKS } from './scenario'

export type Foundation = {
  eventId: string
  rooms: Ensured
  tracks: Ensured
  tags: Ensured
  speakers: Ensured
  admins: Ensured
}

/** Ordered lookups, so `order` is the sort column every picker reads. Section 3. */
function ordered(eventId: string, names: readonly string[], color?: readonly string[]): FieldSet[] {
  return names.map((name, index) => ({
    [COL.name]: name,
    [COL.event]: link(eventId),
    [COL.order]: index + 1,
    ...(color === undefined ? {} : { [COL.color]: color.at(index) ?? '#64748b' }),
  }))
}

async function seedEvent(ensure: SeedContext['ensure']): Promise<string> {
  const events = await ensure(
    TABLES.events,
    [COL.slug],
    [
      {
        [COL.name]: EVENT.name,
        [COL.slug]: EVENT.slug,
        [COL.eventType]: 'Conference',
        [COL.websiteUrl]: 'https://ai.engineer',
        [COL.location]: 'San Francisco, CA',
        [COL.startsAt]: EVENT.startsAt,
        [COL.endsAt]: EVENT.endsAt,
        [COL.timezone]: EVENT.timezone,
        [COL.theme]: 'Agents that ship.',
        [COL.cfpDeadline]: EVENT.cfpDeadline,
        [COL.submissionLimitPerUser]: 3,
        [COL.status]: 'open',
        [COL.accelSyncEnabled]: false,
      },
    ],
  )
  return idFor(events, [EVENT.slug], 'event')
}

const SPEAKER_ROWS: readonly (readonly [string, string, string, string, string])[] = [
  [
    SPEAKERS.ada,
    'Ada',
    'Okafor',
    'Northwind AI',
    'Builds evaluation harnesses for production agents.',
  ],
  [SPEAKERS.bruno, 'Bruno', 'Salgado', 'Vector Foundry', 'Works on retrieval infrastructure.'],
  [
    SPEAKERS.chen,
    'Chen',
    'Wei',
    'Institute for Applied Reasoning',
    'Researches agent planning failures.',
  ],
  [SPEAKERS.dara, 'Dara', 'Nasser', 'Cloudspan', 'Sponsor keynote, developer platform lead.'],
  [
    SPEAKERS.elena,
    'Elena',
    'Marchetti',
    'Ledgerline',
    'Runs a platform team on a tool-calling budget.',
  ],
  [
    SPEAKERS.farid,
    'Farid',
    'Haddad',
    'Opsloop',
    'Observability for systems that argue with themselves.',
  ],
  [SPEAKERS.gita, 'Gita', 'Raman', 'Quorum Labs', 'Tests prompts the way she tests compilers.'],
  [
    SPEAKERS.hugo,
    'Hugo',
    'Lindqvist',
    'Sundial',
    'Maintains vector indexes nobody wants to think about.',
  ],
]

/**
 * A demo headshot per speaker, because the seed used to give them none and three judged public
 * surfaces have a headshot column: the Speakers List and Speaker Gallery widgets, and the public
 * speaker profile. Every one of them fell back to initials on a freshly seeded base, so the
 * column existed and demonstrated nothing.
 *
 * An illustrated portrait rather than a photograph: these are invented people, and a stock face
 * against an invented name reads as a real person's picture used without them. Seeded on the
 * NAME, so a re-seed does not reshuffle the roster and the same person keeps their face.
 *
 * Not uploaded to R2 the way a real headshot is. The seed talks to Airtable and nothing else,
 * and giving it bucket credentials to place demo images would be a much bigger dependency than
 * the problem deserves. A speaker who uploads their own through the portal overwrites this, and
 * `ensure` only ever CREATES, so neither this nor a re-seed can take their photograph away.
 */
function demoHeadshot(firstName: string, lastName: string): string {
  const seed = encodeURIComponent(`${firstName} ${lastName}`)
  return `https://api.dicebear.com/9.x/notionists/png?seed=${seed}&size=256&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`
}

/** Pronouns are a single select, so only values the migration declared can be written. */
const PRONOUNS = new Map<string, string>([
  [SPEAKERS.ada, 'she/her'],
  [SPEAKERS.chen, 'they/them'],
  [SPEAKERS.gita, 'she/her'],
])

async function seedSpeakers(ensure: SeedContext['ensure'], eventId: string): Promise<Ensured> {
  return await ensure(
    TABLES.speakers,
    [COL.email],
    // Through `speakerFields` rather than assembled here, so the seed writes the same
    // shape the portal profile form writes. It is also the only thing that knows the
    // social links go to `linksJson` and not to `links`.
    SPEAKER_ROWS.map(([email, firstName, lastName, company, bio]) =>
      speakerFields({
        email,
        firstName,
        lastName,
        company,
        bio,
        headshotUrl: demoHeadshot(firstName, lastName),
        pronouns: PRONOUNS.get(email),
        links: { website: 'https://example.com' },
        eventIds: [eventId],
      }),
    ),
  )
}

const ADMIN_ROWS: readonly (readonly [string, string, string])[] = [
  [ADMINS.organizer, 'Sam Organizer', 'admin'],
  [ADMINS.reviewerOne, 'Rae Reviewer', 'reviewer'],
  [ADMINS.reviewerTwo, 'Kim Critic', 'reviewer'],
]

async function seedTeamAccess(ensure: SeedContext['ensure'], eventId: string): Promise<Ensured> {
  const admins = await ensure(
    TABLES.adminUsers,
    [COL.email],
    // The AI reviewer is an AdminUsers row and nothing else: `Reviews.reviewer` links to
    // this table, so the pre-screen writes through the same `saveReview` a human does.
    // It is deliberately absent from the memberships below, because a membership would
    // make it a principal `requireEventRole` could satisfy, and nothing should be able to
    // act as it. See `@/types/prescreen`.
    [
      ...ADMIN_ROWS.map(([email, name]) => ({ [COL.email]: email, [COL.name]: name })),
      { [COL.email]: AI_REVIEWER.email, [COL.name]: AI_REVIEWER.name },
    ],
  )

  // Roles are event-scoped, so capability lives here and never in the session cookie:
  // a role baked into a 30-day JWT cannot be revoked for 30 days. Section 4.
  await ensure(
    TABLES.eventMemberships,
    [COL.event, COL.user],
    ADMIN_ROWS.map(([email, , role]) => ({
      [COL.event]: link(eventId),
      [COL.user]: link(idFor(admins, [email], 'admin user')),
      [COL.role]: EVENT_ROLES.find((known) => known === role) ?? 'reviewer',
      [COL.addedAt]: EVENT.startsAt,
    })),
  )

  return admins
}

export async function seedFoundation({ ensure }: SeedContext): Promise<Foundation> {
  const eventId = await seedEvent(ensure)

  const rooms = await ensure(
    TABLES.rooms,
    [COL.event, COL.name],
    ordered(eventId, [ROOMS.main, ROOMS.workshopA, ROOMS.workshopB]).map((row, index) => ({
      ...row,
      [COL.capacity]: index === 0 ? 800 : 120,
    })),
  )
  const tracks = await ensure(
    TABLES.tracks,
    [COL.event, COL.name],
    ordered(
      eventId,
      [TRACKS.agents, TRACKS.evals, TRACKS.infra, TRACKS.product],
      ['#2563eb', '#7c3aed', '#059669', '#d97706'],
    ),
  )
  // Spelled out rather than run through `ordered`, because section 3 gives Tags no
  // `order` column: they are the alphabetical chip list, not an arranged one.
  const tags = await ensure(
    TABLES.tags,
    [COL.event, COL.name],
    [
      [TAGS.beginner, '#64748b'],
      [TAGS.liveDemo, '#0ea5e9'],
      [TAGS.sponsor, '#f43f5e'],
    ].map(([name, color]) => ({
      [COL.name]: name,
      [COL.event]: link(eventId),
      [COL.color]: color,
    })),
  )

  const speakers = await seedSpeakers(ensure, eventId)
  const admins = await seedTeamAccess(ensure, eventId)

  return { eventId, rooms, tracks, tags, speakers, admins }
}
