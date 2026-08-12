// Sessionize's `All` payload onto bodo's shapes. Pure. BUILD_SPEC 5.0e, Source A.
//
// This is the source with no email. Every speaker produced here lands with `email: ''`
// and on the Needs-email list. See the rule at the top of `normalize-shared.ts`.

import { targetFor } from '@/features/imports/categories'
import {
  clean,
  type NormalizedAgendaItem,
  type NormalizedImport,
  type NormalizedRef,
  type NormalizedSpeaker,
  type NormalizedSubmission,
  positionalParticipant,
  splitName,
} from '@/features/imports/normalize-shared'
import { mapSessionizeStatus } from '@/features/imports/status-map'
import type { SessionizeAll, SessionizeCategory } from '@/services/imports/sessionize'
import type { SpeakerLinks } from '@/types/domain'
import type { ImportCategoryTarget, ImportMapping } from '@/types/imports'

/** Sessionize's `links[]` is untyped free text, so match on the label AND the host
 * rather than trusting `linkType`, which the live payload spells several ways. */
export function sessionizeLinks(
  links: readonly { title?: string | null; url?: string | null; linkType?: string | null }[],
): SpeakerLinks {
  const out: SpeakerLinks = {}
  for (const link of links) {
    const url = clean(link.url)
    if (url === undefined) continue
    const hint = `${link.linkType ?? ''} ${link.title ?? ''} ${url}`.toLowerCase()
    if (hint.includes('linkedin')) out.linkedin ??= url
    else if (hint.includes('twitter') || hint.includes('x.com')) out.x ??= url
    else if (hint.includes('facebook')) out.facebook ??= url
    else out.website ??= url
  }
  return out
}

type CategoryIndex = {
  /** Category item id to the concept the ORGANIZER confirmed it feeds. */
  items: ReadonlyMap<string, { target: ImportCategoryTarget; name: string }>
  tracks: readonly NormalizedRef[]
  tags: readonly NormalizedRef[]
  warnings: readonly string[]
}

/**
 * TRAP 4. Category titles are user-named, so the mapping is the organizer's, never the
 * guess in `categories.ts`. An unconfirmed category is dropped and NAMED: falling back
 * to the suggestion would rewrite an event's taxonomy and the organizer would find out
 * after everything had been written.
 */
export function indexCategories(
  categories: readonly SessionizeCategory[],
  mapping: ImportMapping,
): CategoryIndex {
  const sink: MutableIndex = { items: new Map(), tracks: [], tags: [] }
  const warnings: string[] = []

  for (const category of categories) {
    const target = targetFor(mapping, category.id)
    if (target === undefined) {
      warnings.push(
        `Category "${category.title ?? category.id}" was not mapped, so it was skipped.`,
      )
      continue
    }
    if (target !== 'ignore') indexItems(category, target, sink)
  }

  return { ...sink, warnings }
}

type MutableIndex = {
  items: Map<string, { target: ImportCategoryTarget; name: string }>
  tracks: NormalizedRef[]
  tags: NormalizedRef[]
}

/** `track` and `tag` become records of their own; `format`, `level` and `language` are
 * plain strings on the submission, so only the item index needs them. */
function indexItems(
  category: SessionizeCategory,
  target: Exclude<ImportCategoryTarget, 'ignore'>,
  sink: MutableIndex,
): void {
  for (const item of category.items) {
    const name = clean(item.name)
    if (name === undefined) continue
    sink.items.set(item.id, { target, name })
    if (target === 'track') {
      sink.tracks.push({ remoteId: item.id, name, order: item.sort ?? undefined })
    }
    if (target === 'tag') sink.tags.push({ remoteId: item.id, name })
  }
}

/**
 * TRAP 1 made load-bearing rather than decorative.
 *
 * `session.speakers[]` holds speaker GUIDs while `speaker.sessions[]` holds INTEGER
 * session ids and `session.id` is a STRING. Both were coerced to string at the Zod
 * boundary, so this reverse link actually joins. Without that coercion `get(14022)`
 * misses `'14022'` every time, the reverse link contributes nothing, and a speaker
 * listed only on their own record silently loses every session they are on.
 */
export function buildCast(payload: SessionizeAll): ReadonlyMap<string, readonly string[]> {
  const cast = new Map<string, string[]>(
    payload.sessions.map((session) => [session.id, [...session.speakers]]),
  )
  for (const speaker of payload.speakers) {
    for (const sessionId of speaker.sessions) {
      const list = cast.get(sessionId)
      if (list !== undefined && !list.includes(speaker.id)) list.push(speaker.id)
    }
  }
  return cast
}

function toSpeaker(speaker: SessionizeAll['speakers'][number]): NormalizedSpeaker {
  const split = splitName(speaker.fullName)
  return {
    remoteId: speaker.id,
    // Empty, always. There is no email in the payload and none is invented here.
    email: '',
    firstName: clean(speaker.firstName) ?? split.firstName,
    lastName: clean(speaker.lastName) ?? split.lastName,
    bio: clean(speaker.bio),
    // `tagLine` often holds a company, but guessing one out of it invents data, so it
    // lands on `tagline` and `company` stays empty.
    tagline: clean(speaker.tagLine),
    headshotUrl: clean(speaker.profilePicture),
    links: sessionizeLinks(speaker.links),
  }
}

export function normalizeSessionize(
  payload: SessionizeAll,
  mapping: ImportMapping,
): NormalizedImport {
  const index = indexCategories(payload.categories, mapping)
  const cast = buildCast(payload)
  const speakers = payload.speakers.map(toSpeaker)
  const submissions: NormalizedSubmission[] = []
  const agendaItems: NormalizedAgendaItem[] = []

  for (const session of payload.sessions) {
    const placement = {
      roomRemoteId: session.roomId ?? undefined,
      startsAt: clean(session.startsAt),
      endsAt: clean(session.endsAt),
    }
    const title = clean(session.title) ?? ''

    // TRAP 3: a service session (the demo event's `Lunch`) carries `status: null` and
    // `isServiceSession: true`. It is agenda furniture with no speaker, so it becomes an
    // agenda row and never a submission at any status.
    if (mapSessionizeStatus(session).kind === 'agenda_only') {
      agendaItems.push({ remoteId: session.id, title, ...placement })
      continue
    }

    const chosen = session.categoryItems.flatMap((id) => {
      const item = index.items.get(id)
      return item === undefined ? [] : [{ id, ...item }]
    })
    const named = (target: ImportCategoryTarget): string | undefined =>
      chosen.find((item) => item.target === target)?.name

    submissions.push({
      remoteId: session.id,
      title,
      description: clean(session.description),
      // TRAP 2: only accepted sessions are exposed, so every one of these is accepted
      // and none of them can seed a review queue.
      status: 'accepted',
      reviewRequired: false,
      format: named('format'),
      level: named('level'),
      language: named('language'),
      trackRemoteId: chosen.find((item) => item.target === 'track')?.id,
      tagRemoteIds: chosen.filter((item) => item.target === 'tag').map((item) => item.id),
      ...placement,
      participants: (cast.get(session.id) ?? []).map(positionalParticipant),
    })
  }

  return {
    source: 'sessionize',
    rooms: payload.rooms.map((room) => ({
      remoteId: room.id,
      name: clean(room.name) ?? '',
      order: room.sort ?? undefined,
    })),
    tracks: index.tracks,
    tags: index.tags,
    speakers,
    submissions,
    agendaItems,
    // Every Sessionize speaker, because every one of them lacks an address.
    needsEmail: speakers.map((speaker) => ({
      name: `${speaker.firstName} ${speaker.lastName}`.trim(),
      remoteId: speaker.remoteId,
    })),
    skipped: { speakers: 0, submissions: 0 },
    warnings: index.warnings,
  }
}
