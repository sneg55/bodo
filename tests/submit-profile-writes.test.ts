// A public submit may not rewrite somebody else's speaker profile.
//
// The second half of the impersonation hole in `@/features/auth/submitter-identity`. The
// first half (an anonymous POST binding to an existing record) is refused before any write
// happens and is pinned in tests/auth-submitter-identity.test.ts. This one is about the
// CO-PRESENTERS the same POST names, who never proved anything: they still have to be
// linked to the event, and their own name, bio and company have to survive it.
//
// Verified against the real mutation before this was written: `upsertSpeakerByEmail` calls
// `speakerFields({ ...draft, eventIds })` on the existing-row branch, and `speakerFields`
// writes `firstName` whenever the draft carries one, so the typed value landed on the
// stored record.

import { describe, expect, it, vi } from 'vitest'

const upsertSpeakerByEmail = vi.fn()

vi.mock('@/services/airtable/mutations-speakers', () => ({
  upsertSpeakerByEmail: (...args: unknown[]): unknown => upsertSpeakerByEmail(...args) as unknown,
}))

const { upsertSpeakers } = await import('@/features/submissions/submit-cast')

type Participant = Parameters<typeof upsertSpeakers>[0][number]

function participant(email: string, over: Record<string, unknown> = {}): Participant {
  return {
    draft: { email, firstName: 'Typed', lastName: 'Name', eventIds: ['recEvt1'] },
    role: 'speaker',
    isPrimary: false,
    sortOrder: 0,
    ...over,
  }
}

function optionsFor(email: string): { profileWrites?: boolean } | undefined {
  const call = upsertSpeakerByEmail.mock.calls.find(
    (args) => (args.at(0) as { email: string }).email === email,
  )
  return call?.at(2) as { profileWrites?: boolean } | undefined
}

describe('upsertSpeakers', () => {
  it('lets the PROVEN submitter write their own profile', async () => {
    upsertSpeakerByEmail.mockReset().mockResolvedValue({ id: 'recSpk1' })

    await upsertSpeakers([participant('ada@example.com')], 'ada@example.com')

    expect(optionsFor('ada@example.com')?.profileWrites).toBe(true)
  })

  it('refuses profile writes for a co-presenter the submitter merely NAMED', async () => {
    // The defect: the submitter types a co-speaker's name and email into the wizard, and
    // that typed name landed on the co-speaker's own record.
    upsertSpeakerByEmail.mockReset().mockResolvedValue({ id: 'recSpk2' })

    await upsertSpeakers(
      [participant('ada@example.com'), participant('marcus@example.com')],
      'ada@example.com',
    )

    expect(optionsFor('marcus@example.com')?.profileWrites).toBe(false)
  })

  it('still upserts the co-presenter, so they are linked to the event', async () => {
    upsertSpeakerByEmail.mockReset().mockResolvedValue({ id: 'recSpk2' })

    await upsertSpeakers(
      [participant('ada@example.com'), participant('marcus@example.com')],
      'ada@example.com',
    )

    expect(upsertSpeakerByEmail).toHaveBeenCalledTimes(2)
  })

  it('compares addresses case and whitespace insensitively', async () => {
    // The submitter's address arrives from the payload and the participant's from a form
    // field, so one carrying a capital or a trailing space must not cost them their profile.
    upsertSpeakerByEmail.mockReset().mockResolvedValue({ id: 'recSpk1' })

    await upsertSpeakers([participant('  Ada@Example.com ')], 'ada@example.com')

    expect(optionsFor('  Ada@Example.com ')?.profileWrites).toBe(true)
  })

  it('upserts one row for a form that lists the same person twice', async () => {
    upsertSpeakerByEmail.mockReset().mockResolvedValue({ id: 'recSpk1' })

    await upsertSpeakers(
      [participant('ada@example.com'), participant('ada@example.com')],
      'ada@example.com',
    )

    expect(upsertSpeakerByEmail).toHaveBeenCalledTimes(1)
  })
})
