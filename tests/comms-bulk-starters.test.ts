// The templates the composer offers as a starting point. SPK-13.
//
// The rule worth pinning is `resolveTemplate`'s, reapplied: a stored row wins, and a stored
// row with a BLANK body does not. Getting that wrong here means the organizer edits a body
// their speakers were never sent, which is the exact failure the single-source-of-defaults
// argument in template-keys.ts exists to prevent.

import { describe, expect, it } from 'vitest'

import { bulkEmailStarters } from '@/features/comms/bulk-starters'
import { EDITABLE_TEMPLATES, TEMPLATE_KEYS } from '@/features/comms/template-keys'
import type { EmailTemplate } from '@/types/domain'

function stored(overrides: Partial<EmailTemplate>): EmailTemplate {
  return {
    id: 'recTemplate',
    eventId: 'recEvent',
    key: TEMPLATE_KEYS.speakerInvite,
    subject: '',
    bodyMarkdown: '',
    attachIcs: false,
    ...overrides,
  }
}

function starterFor(rows: readonly EmailTemplate[], key: string) {
  const found = bulkEmailStarters(rows).find((entry) => entry.key === key)
  if (found === undefined) throw new Error(`no starter for ${key}`)
  return found
}

describe('bulkEmailStarters', () => {
  it('offers every editable template, so nothing an organizer wrote is unreachable', () => {
    expect(bulkEmailStarters([]).map((entry) => entry.key)).toEqual(
      EDITABLE_TEMPLATES.map((meta) => meta.key),
    )
  })

  it('shows the built-in body as HTML when nothing is stored', () => {
    const starter = starterFor([], TEMPLATE_KEYS.speakerInvite)

    expect(starter.subject).toBe('Your {{event.name}} speaker portal')
    // Converted the same way the sender would convert it, so the draft is what that
    // template would have mailed rather than its markdown source.
    expect(starter.bodyHtml).toContain('<p>')
    expect(starter.customized).toBe(false)
  })

  it('lets a stored row win, and marks it customized', () => {
    const starter = starterFor(
      [stored({ subject: 'Come speak', bodyMarkdown: 'Hi **{{speaker.firstName}}**' })],
      TEMPLATE_KEYS.speakerInvite,
    )

    expect(starter.subject).toBe('Come speak')
    expect(starter.bodyHtml).toContain('<strong>{{speaker.firstName}}</strong>')
    expect(starter.customized).toBe(true)
  })

  it('does not let a BLANK stored body win', () => {
    // Airtable's `+` makes blank rows, and an organizer clearing an editor means "go back to
    // the built-in text". Offering an empty draft would look like the template was lost.
    const starter = starterFor([stored({ bodyMarkdown: '   ' })], TEMPLATE_KEYS.speakerInvite)

    expect(starter.bodyHtml).toContain('speaker portal')
    expect(starter.customized).toBe(false)
  })

  it('falls back on a blank subject independently of the body', () => {
    const starter = starterFor(
      [stored({ subject: '  ', bodyMarkdown: 'Custom body' })],
      TEMPLATE_KEYS.speakerInvite,
    )

    expect(starter.subject).toBe('Your {{event.name}} speaker portal')
    expect(starter.bodyHtml).toContain('Custom body')
  })

  it('never hands the composer a blank subject, whatever the stored rows look like', () => {
    // An eval run reported "picking a template loads the body but leaves the subject blank"
    // and the resolution below was the first suspect, so the invariant is pinned rather than
    // re-argued: EVERY starter carries a subject, for every shape a stored row can take.
    // (The report itself did not reproduce. An `<input>` holds its value as a DOM property,
    // so it is absent from `innerText`, while the body is a contenteditable whose text is
    // there; a page-text read of the drawer shows exactly that asymmetry with nothing wrong.)
    const shapes: readonly (readonly EmailTemplate[])[] = [
      [],
      [stored({})],
      [stored({ subject: '', bodyMarkdown: 'Body' })],
      [stored({ subject: '   ', bodyMarkdown: '   ' })],
      [stored({ subject: '\n\t', bodyMarkdown: 'Body' })],
      [stored({ key: 'not-an-editable-key', subject: 'Ignored' })],
      EDITABLE_TEMPLATES.map((meta) => stored({ key: meta.key, subject: '' })),
    ]

    for (const rows of shapes) {
      for (const starter of bulkEmailStarters(rows)) {
        expect(starter.subject.trim()).not.toBe('')
      }
    }
  })

  it('keeps merge tokens intact through the markdown conversion, links included', () => {
    // `marked` percent-encodes a link destination, which once shipped as two built-in
    // templates that rendered perfectly and linked nowhere.
    const starter = starterFor([], TEMPLATE_KEYS.speakerInvite)

    expect(starter.bodyHtml).toContain('href="{{portalUrl}}"')
    expect(starter.bodyHtml).not.toContain('%7B%7B')
  })
})
