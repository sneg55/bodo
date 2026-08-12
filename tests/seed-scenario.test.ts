// The seed, end to end against an in-memory base.
//
// Three things are asserted, and each of them is a way the seed has failed before it
// could ever be run against real credentials:
//
//   1. The deliberate room conflict actually lands. It is the point of the seed, and a
//      row count cannot tell a base that has it from one that does not, so the seeded
//      rows are fed to the real `buildConflictReport` and the pair is asserted.
//   2. A second run creates nothing. The keying is unit tested in seed-keys.test.ts;
//      this proves every step actually keys on something stable.
//   3. Writes reach the wire in batches of at most ten, which is Airtable's ceiling.
//
// It does NOT prove the field names or types are right: only a real base can, because
// this fake accepts any field on any table. See the report for what that leaves open.

import { beforeAll, describe, expect, it } from 'vitest'

import { buildConflictReport, type ScheduledSession } from '@/features/agenda/conflicts'
import { speakerResources } from '@/features/resources/pages'
import { MAX_BATCH } from '@/services/airtable/client'
import { mapPortalItem, mapResource } from '@/services/airtable/mapping-resources'
import { linkIds, optionalLink, optionalText, view } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { makeContext } from '../scripts/seed/ensure'
import { CONFLICT, EVENT, FORM, RESOURCES } from '../scripts/seed/scenario'
import { seedContent } from '../scripts/seed/steps-content'
import { seedForm } from '../scripts/seed/steps-form'
import { seedFoundation } from '../scripts/seed/steps-foundation'
import { seedPortal } from '../scripts/seed/steps-portal'
import { seedReview } from '../scripts/seed/steps-review'
import { SUBMISSIONS } from '../scripts/seed/submissions-data'
import { type FakeAirtable, fakeAirtable } from './helpers/fake-airtable'

async function seedAll(base: FakeAirtable): Promise<void> {
  const ctx = makeContext({ client: base.client })
  const foundation = await seedFoundation(ctx)
  const formId = await seedForm(ctx, foundation)
  const content = await seedContent(ctx, foundation, formId)
  await seedReview(ctx, foundation, content)
  await seedPortal(ctx, foundation, content)
}

/** The agenda's own input shape, rebuilt from the rows the seed wrote. */
function scheduledSessions(base: FakeAirtable): readonly ScheduledSession[] {
  const participants = base.rows(TABLES.submissionParticipants).map((record) => {
    const source = view(TABLES.submissionParticipants, record)
    return {
      submissionId: optionalLink(source, COL.submission),
      speakerId: optionalLink(source, COL.speaker),
    }
  })

  return base.rows(TABLES.submissions).map((record) => {
    const source = view(TABLES.submissions, record)
    return {
      id: record.id,
      roomId: optionalLink(source, COL.room),
      startsAt: optionalText(source, COL.startsAt),
      endsAt: optionalText(source, COL.endsAt),
      participantSpeakerIds: participants
        .filter((row) => row.submissionId === record.id)
        .flatMap((row) => (row.speakerId === undefined ? [] : [row.speakerId])),
    }
  })
}

function titleOf(base: FakeAirtable, id: string): string {
  const record = base.rows(TABLES.submissions).find((row) => row.id === id)
  return record === undefined ? '' : (optionalText(view('s', record), COL.title) ?? '')
}

describe('seeding an empty base', () => {
  let base: FakeAirtable

  beforeAll(async () => {
    base = fakeAirtable()
    await seedAll(base)
  })

  it('creates one event, keyed on its slug', () => {
    const events = base.rows(TABLES.events)
    expect(events).toHaveLength(1)
    expect(optionalText(view('e', events[0]), COL.slug)).toBe(EVENT.slug)
  })

  it('creates the three rooms and four tracks section 9 asks for', () => {
    expect(base.rows(TABLES.rooms)).toHaveLength(3)
    expect(base.rows(TABLES.tracks)).toHaveLength(4)
  })

  it('publishes one CFP form at the public id the URL carries', () => {
    const forms = base.rows(TABLES.forms)
    expect(forms).toHaveLength(1)
    const source = view('f', forms[0])
    expect(optionalText(source, COL.publicId)).toBe(FORM.publicId)
    expect(optionalText(source, COL.status)).toBe('published')
  })

  it('gives that form exactly one conditional field and two routing rules', () => {
    const source = view('f', base.rows(TABLES.forms)[0])
    const fields = JSON.parse(optionalText(source, COL.fieldsJson) ?? '[]') as {
      showIf?: unknown
    }[]
    expect(fields.filter((field) => field.showIf !== undefined)).toHaveLength(1)

    const routing = JSON.parse(optionalText(source, COL.routingJson) ?? '{}') as {
      rules?: unknown[]
      defaultTrackId?: string
    }
    expect(routing.rules).toHaveLength(2)
    // Resolved to a real record id, not a track name: a rule pointing at a name
    // routes nothing.
    expect(routing.defaultTrackId).toMatch(/^rec/)
  })

  it('creates twelve submissions, four of them accepted', () => {
    const rows = base.rows(TABLES.submissions)
    expect(rows).toHaveLength(12)
    expect(SUBMISSIONS).toHaveLength(12)
    const accepted = rows.filter(
      (record) => optionalText(view('s', record), COL.status) === 'accepted',
    )
    expect(accepted).toHaveLength(4)
  })

  it('places exactly two of them on the grid and leaves the rest unscheduled', () => {
    const scheduled = base
      .rows(TABLES.submissions)
      .filter((record) => optionalText(view('s', record), COL.scheduleStatus) === 'scheduled')
    expect(scheduled).toHaveLength(2)
  })

  it('gives one submission three participants, so co-speaker rules have input', () => {
    const counts = new Map<string, number>()
    for (const record of base.rows(TABLES.submissionParticipants)) {
      const id = optionalLink(view('p', record), COL.submission) ?? ''
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect(Math.max(...counts.values())).toBe(3)
  })

  it('marks exactly one participant per submission as primary', () => {
    const primaries = new Map<string, number>()
    for (const record of base.rows(TABLES.submissionParticipants)) {
      const source = view('p', record)
      if (source.get(COL.isPrimary) !== true) continue
      const id = optionalLink(source, COL.submission) ?? ''
      primaries.set(id, (primaries.get(id) ?? 0) + 1)
    }
    expect([...primaries.values()].every((n) => n === 1)).toBe(true)
    expect(primaries.size).toBe(12)
  })

  it('gives two reviewers a membership and leaves scores partial', () => {
    const reviewerMemberships = base
      .rows(TABLES.eventMemberships)
      .filter((record) => optionalText(view('m', record), COL.role) === 'reviewer')
    expect(reviewerMemberships).toHaveLength(2)

    // Fewer reviews than assignments is the half-done state the Evaluation surface has
    // to render, and one of those reviews has a single criterion and no recommendation.
    const assignments = base.rows(TABLES.reviewAssignments)
    const reviews = base.rows(TABLES.reviews)
    expect(reviews.length).toBeLessThan(assignments.length)
    const abstentions = reviews.filter(
      (record) => optionalText(view('r', record), COL.recommendation) === undefined,
    )
    expect(abstentions).toHaveLength(1)
  })

  it('creates three tasks, email templates and two resource pages', () => {
    expect(base.rows(TABLES.tasks)).toHaveLength(3)
    expect(base.rows(TABLES.emailTemplates).length).toBeGreaterThanOrEqual(2)
    expect(base.rows(TABLES.resources)).toHaveLength(2)
  })

  it('queues no email, because a seed has no business promising one', () => {
    expect(base.rows(TABLES.emailOutbox)).toEqual([])
  })

  it('never sends more than ten records in one write', () => {
    expect(base.createBatchSizes.length).toBeGreaterThan(0)
    expect(Math.max(...base.createBatchSizes)).toBeLessThanOrEqual(MAX_BATCH)
  })

  it('links every submission to the event and to a track', () => {
    for (const record of base.rows(TABLES.submissions)) {
      const source = view('s', record)
      expect(linkIds(source, COL.event)).toHaveLength(1)
      expect(linkIds(source, COL.track)).toHaveLength(1)
    }
  })
})

describe('the deliberate conflict', () => {
  let base: FakeAirtable

  beforeAll(async () => {
    base = fakeAirtable()
    await seedAll(base)
  })

  it('is found by the real conflict detector, in the same room', () => {
    const report = buildConflictReport(scheduledSessions(base))
    const room = report.conflicts.filter((conflict) => conflict.kind === 'room')
    expect(room).toHaveLength(1)
    expect([titleOf(base, room[0].aId), titleOf(base, room[0].bId)].sort()).toEqual(
      [CONFLICT.a.title, CONFLICT.b.title].sort(),
    )
  })

  it('also trips the participant rule, because a co-speaker is on both sides', () => {
    const report = buildConflictReport(scheduledSessions(base))
    const participant = report.conflicts.filter((conflict) => conflict.kind === 'participant')
    expect(participant).toHaveLength(1)
    expect([titleOf(base, participant[0].aId), titleOf(base, participant[0].bId)].sort()).toEqual(
      [CONFLICT.a.title, CONFLICT.b.title].sort(),
    )
  })

  it('badges both cards, so the agenda has something to render', () => {
    const report = buildConflictReport(scheduledSessions(base))
    expect(report.bySession.size).toBe(2)
    expect(report.count).toBe(2)
  })

  it('gives the event exactly one default portal, without which the feature is unusable', () => {
    // The seed writes its event row directly rather than through `createEventAction`, so
    // this is the only thing between a seeded base and an event with no portal at all.
    // That is not a degraded state: `matchPortal` returns undefined so every speaker has
    // no portal, and `savePortalAction` refuses every save, including the one that would
    // create the portal which fixes it.
    const portals = base.rows(TABLES.portals)
    expect(portals).toHaveLength(1)

    const source = view(TABLES.portals, portals[0])
    expect(optionalText(source, COL.name)).toBe('Speaker Portal')
    expect(linkIds(source, COL.event)).toHaveLength(1)
  })

  it('publishes both resource pages, so a speaker can actually open them', () => {
    // Fed to the real visibility rule rather than counted, for the reason the conflict
    // tests above give: a row count cannot tell a base where the pages are published from
    // one where they are drafts, and those are the same two Resources rows either way.
    // Section 9 seeds two pages so judges "land on a system that looks alive", and a page
    // with no enabled PortalItems row renders nowhere at all.
    const eventId = base.rows(TABLES.events)[0].id
    const visible = speakerResources(
      eventId,
      base.rows(TABLES.resources).map(mapResource),
      base.rows(TABLES.portalItems).map(mapPortalItem),
    )

    expect(visible.map((resource) => resource.slug).sort()).toEqual(
      [RESOURCES.handbook, RESOURCES.travel].sort(),
    )
  })
})

describe('seeding a base that is already seeded', () => {
  it('creates nothing the second time', async () => {
    const base = fakeAirtable()
    await seedAll(base)
    const afterFirst = base.createBatchSizes.length
    const rowCount = (): number =>
      Object.values(TABLES).reduce((total, table) => total + base.rows(table).length, 0)
    const before = rowCount()

    await seedAll(base)

    expect(base.createBatchSizes.length).toBe(afterFirst)
    expect(rowCount()).toBe(before)
  })
})
