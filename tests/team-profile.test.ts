// The one rule over an admin's own display name, and the invitation copy next to it.
//
// Both are pure and both feed something expensive to debug through the UI: the name lands in
// a column every admin surface reads, and the invitation is the only email in the product
// composed in code rather than from an editable template.

import { describe, expect, it } from 'vitest'

import { teamInviteEmail } from '@/features/team/invite-email'
import {
  checkProfileName,
  normalizeProfileName,
  PROFILE_NAME_MAX_LENGTH,
} from '@/features/team/profile'

describe('normalizeProfileName', () => {
  it('trims the ends', () => {
    expect(normalizeProfileName('  Dara Nasser  ')).toBe('Dara Nasser')
  })

  it('collapses internal runs of whitespace to one space', () => {
    // `actingInitials` splits on whitespace to build the avatar, so a double space is
    // invisible there and visible in the table. Storing the collapsed form makes them agree.
    expect(normalizeProfileName('Dara   \t Nasser')).toBe('Dara Nasser')
  })

  it('reduces a whitespace-only value to blank rather than to a space', () => {
    expect(normalizeProfileName('   ')).toBe('')
  })
})

describe('checkProfileName', () => {
  it('allows a blank name, because that is where every AdminUsers row starts', () => {
    // `createAdminUser` writes an address and no name, so refusing blank would mean the one
    // thing an organizer could not do on a page about their own name is undo it.
    expect(checkProfileName('')).toBeUndefined()
    expect(checkProfileName('   ')).toBeUndefined()
  })

  it('allows a name exactly at the limit', () => {
    expect(checkProfileName('a'.repeat(PROFILE_NAME_MAX_LENGTH))).toBeUndefined()
  })

  it('refuses one character past the limit', () => {
    const problem = checkProfileName('a'.repeat(PROFILE_NAME_MAX_LENGTH + 1))
    expect(problem?.message).toContain(String(PROFILE_NAME_MAX_LENGTH))
  })

  it('measures the NORMALIZED value, so padding is not counted', () => {
    // Refusing this would report a length the stored value does not have.
    expect(checkProfileName(`   ${'a'.repeat(PROFILE_NAME_MAX_LENGTH)}   `)).toBeUndefined()
  })
})

describe('teamInviteEmail', () => {
  const URL = 'https://bodo.example/api/auth/magic?token=abc'

  it('names the event in the subject, so the recipient recognizes it', () => {
    // The defect this replaced: `Your bodo sign-in link`, for a product they had never
    // heard of, with no mention of having been invited to anything.
    const { subject } = teamInviteEmail({ eventName: 'DevConf 2027', role: 'admin', url: URL })

    expect(subject).toContain('DevConf 2027')
  })

  it('leaves the subject unescaped, because a subject line is not markup', () => {
    const { subject } = teamInviteEmail({ eventName: 'AI & ML Summit', role: 'admin', url: URL })

    expect(subject).toContain('AI & ML Summit')
    expect(subject).not.toContain('&amp;')
  })

  it('states the role in the body, differently for each one', () => {
    const admin = teamInviteEmail({ eventName: 'DevConf', role: 'admin', url: URL })
    const reviewer = teamInviteEmail({ eventName: 'DevConf', role: 'reviewer', url: URL })

    expect(admin.html).toContain('as an admin')
    expect(reviewer.html).toContain('as a reviewer')
    expect(reviewer.html).toContain('score the submissions assigned to you')
  })

  it('carries the link both as an anchor and as visible text', () => {
    // A mail client that mangles the anchor still leaves an address that can be copied.
    const { html } = teamInviteEmail({ eventName: 'DevConf', role: 'admin', url: URL })

    expect(html).toContain(`href="${URL}"`)
    expect(html.split(URL).length - 1).toBe(2)
  })

  it('says the link expires, because it arrives unannounced', () => {
    const { html } = teamInviteEmail({ eventName: 'DevConf', role: 'admin', url: URL })

    expect(html).toContain('expires in 15 minutes')
  })

  it('escapes the event name in the body, which is organizer-controlled free text', () => {
    const { html } = teamInviteEmail({
      eventName: '<script>alert(1)</script>',
      role: 'admin',
      url: URL,
    })

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
