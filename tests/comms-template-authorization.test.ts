// Who may rewrite the mail an event sends, and the order the check happens in.
//
// BUILD_SPEC 4: a layout is not a security boundary, so a Server Action authorizes for
// itself. The template panel sits inside `(admin)/admin/[eventId]`, whose layout already
// redirects a stranger, and that protects the rendered page and nothing else: the action is
// reachable by POST with no layout ever rendering.
//
// The assertions that matter are not "it throws". They are that NOTHING WAS WRITTEN and
// nothing was even read when the caller is refused, because a guard that runs after the
// write is decoration. `saveAdminTemplate` takes its dependencies as arguments precisely so
// that ordering is observable here.
//
// The role requirement itself is exercised through the real guard with a stubbed membership
// loader, the way tests/auth-guards.test.ts does it, so this file also pins the decision a
// reviewer gets: `EVENT_ROLES` is `admin | reviewer`, and rewriting the acceptance email
// every speaker receives is not a review capability.

import { describe, expect, it } from 'vitest'

import { isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/guards'
import { TEMPLATE_KEYS } from '@/features/comms/template-keys'
import {
  loadAdminTemplates,
  MAX_BODY_LENGTH,
  saveAdminTemplate,
  type TemplateWriteDeps,
} from '@/features/comms/template-write'
import type { EmailTemplate, EventMembership } from '@/types/domain'

import { ADMIN, membershipRow, SPEAKER, T0 } from './helpers/auth-fakes'

const EVENT_A = 'recEventA'
const EVENT_B = 'recEventB'

const STORED: EmailTemplate = {
  id: 'recTpl1',
  eventId: EVENT_A,
  key: TEMPLATE_KEYS.adminNew,
  subject: 'stored subject',
  bodyMarkdown: 'stored body',
  attachIcs: false,
}

/** The shared fixture, so the row shape here cannot drift from the guards' own tests. */
const membership = membershipRow

/**
 * The real guard, bound to a stub membership loader, wrapped as the dependency the write
 * layer declares. Using the guard rather than a hand-written predicate is the point: a test
 * that asserts against its own copy of the role rule proves nothing about the rule.
 */
function guard(rows: readonly EventMembership[], subject = ADMIN) {
  return async (eventId: string): Promise<void> => {
    await requireEventRole({
      nowMs: T0,
      subject,
      eventId,
      role: 'admin',
      loadMemberships: (userId) => Promise.resolve(rows.filter((row) => row.userId === userId)),
    })
  }
}

/** Records every call, so "was anything written" is answerable. */
function spyDeps(requireAdmin: TemplateWriteDeps['requireAdmin']) {
  const reads: string[] = []
  const writes: { eventId: string; key: string; bodyMarkdown: string }[] = []

  const deps: TemplateWriteDeps = {
    requireAdmin,
    listTemplates: (eventId) => {
      reads.push(eventId)
      return Promise.resolve([STORED])
    },
    save: ({ eventId, edit }) => {
      writes.push({ eventId, key: edit.key, bodyMarkdown: edit.bodyMarkdown })
      return Promise.resolve({ ...STORED, ...edit, eventId })
    },
  }

  return { deps, reads, writes }
}

async function errorIdOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'nothing thrown'
  } catch (error) {
    return isAppError(error) ? error.id : `not an AppError: ${String(error)}`
  }
}

const EDIT = {
  eventId: EVENT_A,
  key: TEMPLATE_KEYS.adminNew,
  subject: 'A new one',
  bodyMarkdown: 'Hi {{speaker.firstName}}',
}

describe('saveAdminTemplate authorization', () => {
  it('lets an admin of the event save', async () => {
    const { deps, writes } = spyDeps(guard([membership(EVENT_A, 'admin')]))

    const saved = await saveAdminTemplate(deps, EDIT)

    expect(writes).toEqual([
      { eventId: EVENT_A, key: TEMPLATE_KEYS.adminNew, bodyMarkdown: 'Hi {{speaker.firstName}}' },
    ])
    expect(saved.customized).toBe(true)
  })

  it('refuses a REVIEWER on the event, and writes nothing', async () => {
    const { deps, writes, reads } = spyDeps(guard([membership(EVENT_A, 'reviewer')]))

    expect(await errorIdOf(() => saveAdminTemplate(deps, EDIT))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
    // Refused before it read anything, which is what "authorize first" means.
    expect(reads).toEqual([])
  })

  it('refuses an admin of a DIFFERENT event, and writes nothing', async () => {
    const { deps, writes } = spyDeps(guard([membership(EVENT_B, 'admin')]))

    expect(await errorIdOf(() => saveAdminTemplate(deps, EDIT))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
  })

  it('refuses a caller with no membership at all, and writes nothing', async () => {
    const { deps, writes } = spyDeps(guard([]))

    expect(await errorIdOf(() => saveAdminTemplate(deps, EDIT))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
  })

  it('refuses a speaker session even on an event whose admin holds the same id', async () => {
    // Impersonation works by acting as a speaker session, so `kind` is what is checked and
    // no admin surface opens up on it (guards.ts `requireAdminUser`).
    const { deps, writes } = spyDeps(guard([membership(EVENT_A, 'admin')], SPEAKER))

    expect(await errorIdOf(() => saveAdminTemplate(deps, EDIT))).toBe('E_AUTH_005')
    expect(writes).toEqual([])
  })

  it('authorizes the READ as well, so a stranger cannot list the event bodies', async () => {
    const { deps, reads } = spyDeps(guard([membership(EVENT_B, 'admin')]))

    expect(await errorIdOf(() => loadAdminTemplates(deps, EVENT_A))).toBe('E_AUTH_005')
    expect(reads).toEqual([])
  })
})

describe('saveAdminTemplate input handling', () => {
  const allowed = () => spyDeps(guard([membership(EVENT_A, 'admin')]))

  it('refuses a key outside the closed list, so a client cannot write any row it likes', async () => {
    const { deps, writes } = allowed()

    expect(await errorIdOf(() => saveAdminTemplate(deps, { ...EDIT, key: 'nonsense' }))).toBe(
      'E_MAIL_002',
    )
    // A `custom-*` key looks like the two admin ones and is still not one of them: the guard
    // is a list, not a shape.
    expect(
      await errorIdOf(() => saveAdminTemplate(deps, { ...EDIT, key: 'custom-anything' })),
    ).toBe('E_MAIL_002')
    expect(writes).toEqual([])
  })

  it('accepts the two decision keys, which Settings > Email Templates edits', async () => {
    const { deps, writes } = allowed()

    // `accepted` used to be refused here, back when the two admin alerts were the whole
    // editable set. It is in `EDITABLE_TEMPLATES` now: the guard did not weaken, the list
    // grew, and both surfaces still post through this one check.
    expect(await errorIdOf(() => saveAdminTemplate(deps, { ...EDIT, key: 'accepted' }))).toBe(
      'nothing thrown',
    )
    expect(await errorIdOf(() => saveAdminTemplate(deps, { ...EDIT, key: 'rejected' }))).toBe(
      'nothing thrown',
    )
    expect(writes.map((write) => write.key)).toEqual(['accepted', 'rejected'])
  })

  it('refuses a merge field the send-time context cannot supply', async () => {
    const { deps, writes } = allowed()

    // Without this the template saves cleanly and then fails permanently on every
    // recipient, with nothing on screen to explain it.
    expect(
      await errorIdOf(() =>
        saveAdminTemplate(deps, { ...EDIT, bodyMarkdown: 'Hi {{speaker.nickname}}' }),
      ),
    ).toBe('E_MAIL_003')
    expect(writes).toEqual([])
  })

  it('accepts every merge field the context does supply', async () => {
    const { deps, writes } = allowed()

    await saveAdminTemplate(deps, {
      ...EDIT,
      subject: '{{submission.code}} for {{event.name}}',
      bodyMarkdown: '{{speaker.firstName}} {{speaker.lastName}} {{submission.title}} {{portalUrl}}',
    })

    expect(writes).toHaveLength(1)
  })

  it('refuses a body past the cap', async () => {
    const { deps, writes } = allowed()

    expect(
      await errorIdOf(() =>
        saveAdminTemplate(deps, { ...EDIT, bodyMarkdown: 'x'.repeat(MAX_BODY_LENGTH + 1) }),
      ),
    ).toBe('E_SUB_003')
    expect(writes).toEqual([])
  })

  it('stores an emptied body, which is how an organizer restores the built-in text', async () => {
    const { deps, writes } = allowed()

    const saved = await saveAdminTemplate(deps, { ...EDIT, bodyMarkdown: '' })

    expect(writes[0].bodyMarkdown).toBe('')
    // Not customized any more, so `resolveTemplate` sends the code default again.
    expect(saved.customized).toBe(false)
  })
})

describe('loadAdminTemplates', () => {
  it('returns both rows in panel order, with the stored one marked customized', async () => {
    const { deps } = spyDeps(guard([membership(EVENT_A, 'admin')]))

    const values = await loadAdminTemplates(deps, EVENT_A)

    expect(values.map((value) => value.key)).toEqual([
      TEMPLATE_KEYS.adminNew,
      TEMPLATE_KEYS.adminUpdate,
    ])
    expect(values[0]).toMatchObject({ bodyMarkdown: 'stored body', customized: true })
    // No row for the second key: empty, and the built-in default is what would send.
    expect(values[1]).toMatchObject({ bodyMarkdown: '', customized: false })
    expect(values[1].defaultBody.length).toBeGreaterThan(0)
  })
})
