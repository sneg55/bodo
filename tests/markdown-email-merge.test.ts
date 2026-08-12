// Merge tokens surviving the markdown converter.
//
// The defect these pin was silent, shipped in two built-in templates, and confirmed in a
// live EmailOutbox row: `marked` treats a link destination as a URL and percent-encodes it,
// so a token in an href stopped looking like a token by the time substitution ran. The
// anchor TEXT merged and the href did not, which produced mail that rendered perfectly,
// read correctly, and linked nowhere.
//
// That is the worst shape a bug can take, because nothing about the result looks wrong to
// whoever sent it, so the regression is worth a test even though the fix is three lines.

import { describe, expect, it } from 'vitest'

import { emailHtmlFromMarkdown } from '@/features/comms/markdown-email'
import { renderTemplate } from '@/features/comms/templates'

describe('emailHtmlFromMarkdown', () => {
  it('leaves a merge token in a link destination alone', () => {
    // The exact shape the remediation plan reproduced in isolation.
    const html = emailHtmlFromMarkdown('[{{portalUrl}}]({{portalUrl}})')

    expect(html).toContain('href="{{portalUrl}}"')
    expect(html).not.toContain('%7B%7B')
  })

  it('restores a dotted token, which is what most fields are', () => {
    const html = emailHtmlFromMarkdown('[Open]({{submission.title}})')
    expect(html).toContain('href="{{submission.title}}"')
  })

  it('still encodes an ordinary URL, so nothing else about links changed', () => {
    // Angle brackets are how markdown carries a destination containing a space. The space
    // must still become %20: the fix restores merge tokens and nothing else.
    const html = emailHtmlFromMarkdown('[Docs](<https://example.com/a b>)')
    expect(html).toContain('https://example.com/a%20b')
  })

  it('leaves a plain URL exactly as written', () => {
    const html = emailHtmlFromMarkdown('[Docs](https://example.com/guide)')
    expect(html).toContain('href="https://example.com/guide"')
  })

  it('leaves a token in ordinary prose untouched, as it always did', () => {
    expect(emailHtmlFromMarkdown('Hello {{speaker.firstName}}')).toContain('{{speaker.firstName}}')
  })
})

describe('the round trip that was broken', () => {
  it('merges the href as well as the anchor text', () => {
    // Before the fix this produced `<a href="%7B%7BportalUrl%7D%7D">https://...</a>`: the
    // visible text was right, so the mail looked correct, and the link was dead.
    const html = emailHtmlFromMarkdown('[{{portalUrl}}]({{portalUrl}})')
    const rendered = renderTemplate(html, {
      speaker: { firstName: 'Ada', lastName: 'Okafor', email: 'ada@example.com' },
      event: { name: 'AI Engineer Sandbox', slug: 'ai-engineer-sandbox' },
      portalUrl: 'https://bodo.example/portal',
    })

    expect(rendered).toContain('href="https://bodo.example/portal"')
    expect(rendered).not.toContain('{{portalUrl}}')
    expect(rendered).not.toContain('%7B%7B')
  })
})
