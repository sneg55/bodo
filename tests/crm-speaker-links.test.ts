import { describe, expect, it } from 'vitest'

import { speakerLinkHref, speakerProfileLinks } from '@/features/crm/speaker-links'
import type { Speaker } from '@/types/domain'

const speaker = (links: Speaker['links']): Speaker => ({
  id: 'spk1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  links,
})

describe('speakerLinkHref', () => {
  it('adds a scheme to what a speaker actually types', () => {
    expect(speakerLinkHref('linkedin.com/in/ada')).toBe('https://linkedin.com/in/ada')
  })

  it('leaves a stored http:// alone rather than upgrading it', () => {
    expect(speakerLinkHref('http://example.com/')).toBe('http://example.com/')
  })

  it('keeps an https URL as it is', () => {
    expect(speakerLinkHref('https://example.com/ada')).toBe('https://example.com/ada')
  })

  it('treats a host with a port as a host, not a scheme', () => {
    expect(speakerLinkHref('example.com:8080/ada')).toBe('https://example.com:8080/ada')
  })

  it('refuses a scheme nobody puts in a Website field', () => {
    expect(speakerLinkHref('mailto:ada@example.com')).toBeUndefined()
    expect(speakerLinkHref('javascript:alert(1)')).toBeUndefined()
    expect(speakerLinkHref('data:text/html,<script>')).toBeUndefined()
  })

  it('refuses blank and whitespace', () => {
    expect(speakerLinkHref('')).toBeUndefined()
    expect(speakerLinkHref('   ')).toBeUndefined()
  })
})

describe('speakerProfileLinks', () => {
  it('drops the fields the speaker left empty and keeps the portal form order', () => {
    const rows = speakerProfileLinks(
      speaker({ website: 'example.com', linkedin: 'linkedin.com/in/ada' }),
    )
    expect(rows.map((row) => row.label)).toEqual(['LinkedIn URL', 'Website'])
  })

  it('keeps a value it cannot link, without an href, rather than pretending it is absent', () => {
    const rows = speakerProfileLinks(speaker({ website: 'mailto:ada@example.com' }))
    expect(rows).toEqual([{ label: 'Website', text: 'mailto:ada@example.com', href: undefined }])
  })

  it('treats a whitespace-only value as empty', () => {
    expect(speakerProfileLinks(speaker({ website: '   ' }))).toEqual([])
  })
})
