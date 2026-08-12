// Completing a task is scoped to the SPEAKER'S events, and only to records that are theirs.
//
// The defect these pin was filed as major by the eval run of 2026-08-11: `MARK COMPLETE` on
// /portal/tasks failed. A submission task answered the error toast "no such task assignment",
// a manual task failed silently, neither survived a reload, and a second eval agent on a
// different speaker reported the same control working. Both are the same cause: the portal
// READS went multi-event and the WRITES stayed on the one configured `PORTAL_EVENT_ID`, so
// completion worked for a task on that event and refused every other one.
//
// Widening a write is where an authorization mistake would live, so the four cases below are
// the contract: a task on the configured event completes, a task on another event the
// speaker belongs to completes, a task belonging to somebody else is refused, and a task on
// an event the speaker is not in is refused AND never even queried.

import { afterEach, describe, expect, it } from 'vitest'

import { ownAssignmentIn, resolveOwnAssignment } from '@/features/portal/own-assignment'
import {
  type PortalDataPort,
  type PortalTaskItem,
  portalDataPort,
  setPortalDataPort,
} from '@/features/portal/ports'
import { errorIdOf, syncErrorIdOf } from './helpers/auth-fakes'
import { assignment, OWNER, STRANGER, task } from './helpers/portal-fakes'

/** What `PORTAL_EVENT_ID` names, and the only event the writes used to look at. */
const CONFIGURED = 'recEventConfigured'
/** A second conference the same speaker presents at. Multi-event portals are the point. */
const OTHER = 'recEventOther'
/** A conference the speaker has nothing to do with. */
const FOREIGN = 'recEventForeign'

const onConfigured: PortalTaskItem = {
  assignment: assignment({ id: 'recAsgConfigured', speakerId: OWNER }),
  task: task({ id: 'recTaskConfigured', eventId: CONFIGURED }),
}

const onOther: PortalTaskItem = {
  assignment: assignment({ id: 'recAsgOther', speakerId: OWNER, submissionId: 'recSub9' }),
  task: task({ id: 'recTaskOther', eventId: OTHER }),
}

/** A row the port hands back that is NOT the caller's: a widened filter, simulated. */
const someoneElses: PortalTaskItem = {
  assignment: assignment({ id: 'recAsgStranger', speakerId: STRANGER }),
  task: task({ id: 'recTaskOther', eventId: OTHER }),
}

const onForeign: PortalTaskItem = {
  assignment: assignment({ id: 'recAsgForeign', speakerId: OWNER }),
  task: task({ id: 'recTaskForeign', eventId: FOREIGN }),
}

const base = portalDataPort()

afterEach(() => {
  setPortalDataPort(base)
})

/** A port over a fixed table of assignments per event, recording what it was asked for. */
function fakePort(byEvent: ReadonlyMap<string, readonly PortalTaskItem[]>): {
  port: PortalDataPort
  queried: string[]
  /** The `fresh` flag each call carried, so a write path reading the cache is a failure. */
  freshness: (boolean | undefined)[]
} {
  const queried: string[] = []
  const freshness: (boolean | undefined)[] = []
  const port: PortalDataPort = {
    ...base,
    listTaskAssignments: ({ eventId, speakerId, fresh }) => {
      queried.push(eventId)
      freshness.push(fresh)
      // Speaker-scoped, exactly as `listTaskAssignmentsForSpeaker` is, EXCEPT where a test
      // deliberately hands back a foreign row to prove the guard does not trust this filter.
      const rows = byEvent.get(eventId) ?? []
      return Promise.resolve(
        rows.filter((row) => row.assignment.speakerId === speakerId || row === someoneElses),
      )
    },
  }
  return { port, queried, freshness }
}

describe('resolveOwnAssignment', () => {
  it('completes a task on the configured portal event', async () => {
    const { port, queried } = fakePort(new Map([[CONFIGURED, [onConfigured]]]))
    setPortalDataPort(port)

    const owned = await resolveOwnAssignment({
      speakerId: OWNER,
      eventIds: [CONFIGURED, OTHER],
      assignmentId: 'recAsgConfigured',
    })

    expect(owned.item.assignment.id).toBe('recAsgConfigured')
    expect(owned.eventId).toBe(CONFIGURED)
    expect(queried).toContain(CONFIGURED)
  })

  it('completes a task on ANOTHER event the speaker belongs to, which is the defect', async () => {
    // This is the case that threw "no such task assignment" on the deployed Worker: the row
    // was on the speaker's page, read across their whole scope, and the write looked for it
    // in one configured event.
    const { port } = fakePort(
      new Map([
        [CONFIGURED, [onConfigured]],
        [OTHER, [onOther]],
      ]),
    )
    setPortalDataPort(port)

    const owned = await resolveOwnAssignment({
      speakerId: OWNER,
      eventIds: [CONFIGURED, OTHER],
      assignmentId: 'recAsgOther',
    })

    expect(owned.item.assignment.id).toBe('recAsgOther')
    // The event it was FOUND under, so the form lookup and the tags this write expires name
    // the conference the task actually belongs to.
    expect(owned.eventId).toBe(OTHER)
  })

  it('reads UNCACHED, because this answer decides ownership for a write', async () => {
    // The 2026-08-12 eval run: every `Mark complete` on the deployed Worker answered "no such
    // task assignment" for rows the speaker was looking at, on two tasks of two different
    // kinds, while the same read run directly against the base returned all ten of that
    // speaker's assignments. A page render and a Server Action are separate requests, so the
    // cached list one of them holds is not the list the other is handed. `read-cache.ts` had
    // already named an assignment lookup on a write path as a read that must not be cached.
    const { port, freshness } = fakePort(new Map([[CONFIGURED, [onConfigured]]]))
    setPortalDataPort(port)

    await resolveOwnAssignment({
      speakerId: OWNER,
      eventIds: [CONFIGURED],
      assignmentId: 'recAsgConfigured',
    })

    expect(freshness).toEqual([true])
  })

  it('refuses an assignment belonging to a different speaker', async () => {
    // The port's own filter is not the check. This one hands the row over anyway, which is
    // what a future port implementation with a widened filter would do.
    const { port } = fakePort(new Map([[OTHER, [someoneElses]]]))
    setPortalDataPort(port)

    expect(
      await errorIdOf(
        async () =>
          await resolveOwnAssignment({
            speakerId: OWNER,
            eventIds: [CONFIGURED, OTHER],
            assignmentId: 'recAsgStranger',
          }),
      ),
    ).toBe('E_AUTH_005')
  })

  it('refuses an assignment on an event the speaker is not in, and never queries it', async () => {
    const { port, queried } = fakePort(
      new Map([
        [CONFIGURED, [onConfigured]],
        [FOREIGN, [onForeign]],
      ]),
    )
    setPortalDataPort(port)

    expect(
      await errorIdOf(
        async () =>
          await resolveOwnAssignment({
            speakerId: OWNER,
            eventIds: [CONFIGURED, OTHER],
            assignmentId: 'recAsgForeign',
          }),
      ),
    ).toBe('E_DATA_001')

    // The scope is an authorization boundary rather than a filter applied afterwards: the
    // event was never read at all, so there is no row to leak and nothing to refuse.
    expect(queried).toEqual([CONFIGURED, OTHER])
  })

  it('reads once per event in the scope, and no more', async () => {
    const { port, queried } = fakePort(new Map([[OTHER, [onOther]]]))
    setPortalDataPort(port)

    await resolveOwnAssignment({
      speakerId: OWNER,
      eventIds: [CONFIGURED, OTHER],
      assignmentId: 'recAsgOther',
    })

    expect(queried).toHaveLength(2)
  })
})

describe('ownAssignmentIn', () => {
  it('returns the event the row was found under, not the first in the scope', () => {
    const owned = ownAssignmentIn(
      [
        { eventId: CONFIGURED, items: [] },
        { eventId: OTHER, items: [onOther] },
      ],
      { speakerId: OWNER, assignmentId: 'recAsgOther' },
    )

    expect(owned.eventId).toBe(OTHER)
  })

  it('answers not-found for an unknown id rather than saying whose it is', () => {
    expect(
      syncErrorIdOf(() =>
        ownAssignmentIn([{ eventId: CONFIGURED, items: [onConfigured] }], {
          speakerId: OWNER,
          assignmentId: 'recAsgNothing',
        }),
      ),
    ).toBe('E_DATA_001')
  })

  it('refuses a foreign row that reached it through a scoped list', () => {
    expect(
      syncErrorIdOf(() =>
        ownAssignmentIn([{ eventId: OTHER, items: [someoneElses] }], {
          speakerId: OWNER,
          assignmentId: 'recAsgStranger',
        }),
      ),
    ).toBe('E_AUTH_005')
  })
})
