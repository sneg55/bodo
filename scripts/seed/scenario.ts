// The identifiers the seed keys on, in one place.
//
// Everything here is a natural key: the event slug, the form's publicId, a room name,
// a submission title. The seed is idempotent because it looks rows up by these, so a
// value edited here after a run makes the seed create a second row rather than update
// the first. Treat them as fixed once a base has been seeded.
//
// The scenario matches src/services/airtable/fixtures, deliberately: the app serves
// fixtures with no credentials and this base with them, and a demo that behaves
// differently between the two proves nothing about either.

import { AI_REVIEWER_EMAIL, AI_REVIEWER_NAME } from '@/types/prescreen'

export const EVENT = {
  name: 'AI Engineer Sandbox',
  slug: 'ai-engineer-sandbox',
  timezone: 'America/Los_Angeles',
  /** Day one of three. Every scheduled slot below sits inside this window. */
  startsAt: '2026-10-12T09:00:00.000Z',
  endsAt: '2026-10-14T18:00:00.000Z',
  cfpDeadline: '2026-09-15T23:59:00.000Z',
} as const

export const FORM = {
  name: 'Call for Speakers 2026',
  /** Opaque and immutable: this is the id in the public /submit URL. */
  publicId: 'cfp2026sandboxdemo01',
  closeDate: EVENT.cfpDeadline,
} as const

export const ROOMS = {
  main: 'Main Stage',
  workshopA: 'Workshop A',
  workshopB: 'Workshop B',
} as const

export const TRACKS = {
  agents: 'Agents',
  evals: 'Evals',
  infra: 'Infra',
  product: 'Product',
} as const

export const TAGS = {
  beginner: 'Beginner Friendly',
  liveDemo: 'Live Demo',
  sponsor: 'Sponsor',
} as const

/**
 * The domain every seeded address is built on.
 *
 * `example.com` is the correct default (RFC 2606 reserves it, so nothing seeded can ever
 * mail a real stranger) and it is also unusable for a live demo: **Resend refuses that
 * domain by name**, answering 422 with "Please use our testing email address instead of
 * domains like `example.com`". Verified against the API, not assumed.
 *
 * That matters because a magic link IS the login (BUILD_SPEC 4). With the default domain,
 * no seeded speaker can ever receive a sign-in link, so the walkthrough in §10 cannot be
 * performed as a speaker at all. Set `SEED_EMAIL_DOMAIN` to a domain that accepts mail
 * before seeding a base somebody is going to demo from.
 *
 * Plus-addressing on one real mailbox is the usual answer, and it works here because the
 * local parts are already distinct: `SEED_EMAIL_DOMAIN=you+bodo.example.org` is not valid,
 * but seeding against a domain you own and catch-all routing is.
 */
const EMAIL_DOMAIN = process.env.SEED_EMAIL_DOMAIN ?? 'example.com'

const at = (local: string): string => `${local}@${EMAIL_DOMAIN}`

export const SPEAKERS = {
  ada: at('ada'),
  bruno: at('bruno'),
  chen: at('chen'),
  dara: at('dara'),
  elena: at('elena'),
  farid: at('farid'),
  gita: at('gita'),
  hugo: at('hugo'),
} as const

export const ADMINS = {
  organizer: at('organizer'),
  reviewerOne: at('reviewer1'),
  reviewerTwo: at('reviewer2'),
} as const

/**
 * The identity every AI pre-screen review is written under (`@/types/prescreen`).
 *
 * NOT built with `at()`, and that is the point: `ai@system` is not a mailbox and must not
 * become one when `SEED_EMAIL_DOMAIN` is set to a domain that accepts mail. It is an
 * AdminUsers row so `Reviews.reviewer` has something to link to, it gets no
 * `EventMemberships` row, and nothing can request a magic link for it, because
 * `requireAdminUser` would then mint a session for a reviewer nobody controls.
 */
export const AI_REVIEWER = { email: AI_REVIEWER_EMAIL, name: AI_REVIEWER_NAME } as const

export const PLAN = { name: '2026 Program Review' } as const
export const ROUNDS = { screening: 'Screening', final: 'Final' } as const
export const TEAM = { name: 'Program Committee' } as const

/**
 * The two scheduled sessions that collide. Named rather than left as strings in the
 * submissions list, because the deliberate conflict is the point of the seed: it is
 * what the agenda's Conflicts tab has to find, and a later edit that moves one of
 * these off the other's slot silently removes the thing a judge is shown.
 *
 * They collide twice over. Same room and overlapping times, so the room rule fires,
 * and Chen co-presents on both, so the participant rule fires on the same pair. That
 * second one needs both rows to have a room, because `toSlot` in conflicts.ts drops a
 * session with no room from consideration entirely.
 */
export const CONFLICT = {
  a: {
    title: 'Evaluating agents without a golden dataset',
    startsAt: '2026-10-12T17:00:00.000Z',
    endsAt: '2026-10-12T17:30:00.000Z',
  },
  b: {
    title: 'Retrieval that survives production traffic',
    startsAt: '2026-10-12T17:15:00.000Z',
    endsAt: '2026-10-12T17:45:00.000Z',
  },
  room: ROOMS.main,
  /** On both sides of the pair, which is what the participant rule catches. */
  sharedCoSpeaker: SPEAKERS.chen,
} as const

export const TASKS = {
  headshot: 'Upload your headshot',
  slides: 'Upload your slides',
  travel: 'Confirm your travel dates',
} as const

export const RESOURCES = { handbook: 'speaker-handbook', travel: 'venue-and-travel' } as const
