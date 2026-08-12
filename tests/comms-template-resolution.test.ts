// Which body gets sent, and what the outbox row says about it.
//
// BUILD_SPEC 5.3 sources each system email from `EmailTemplates[key=...]` and falls back to
// a body in the code. Both halves are asserted here, and so is the label: `templateSource`
// is what an organizer reads in the Comms log when an email came out wrong, so a row that
// claims `template` while carrying the code body is worse than no label at all.

import { describe, expect, it } from 'vitest'

import { resolveTemplate } from '@/features/comms/resolve-template'
import type { MergeContext } from '@/features/comms/templates'
import type { EmailTemplate } from '@/types/domain'

const CONTEXT: MergeContext = {
  speaker: { firstName: 'Ada', lastName: 'Okafor', email: 'ada@example.com' },
  event: { name: 'AI & ML Summit', slug: 'ai-ml-summit' },
  submission: { code: 'SESS-1', title: 'Evaluating agents' },
  portalUrl: 'https://bodo.test/portal',
}

const FALLBACK = {
  subject: 'Your AI & ML Summit submission was accepted',
  html: '<p>Hi {{speaker.firstName}}, the code default speaking.</p>',
  attachIcs: false,
}

function template(overrides: Partial<EmailTemplate> = {}): EmailTemplate {
  return {
    id: 'recTpl1',
    eventId: 'recEvent1',
    key: 'accepted',
    subject: 'Great news about {{submission.title}}',
    bodyMarkdown: 'Hi {{speaker.firstName}},\n\nYou are **in** for {{event.name}}.',
    attachIcs: false,
    ...overrides,
  }
}

describe('resolveTemplate: a stored row wins', () => {
  it('sends the organizer body, converted from markdown, and stamps template', () => {
    const resolved = resolveTemplate({ stored: template(), fallback: FALLBACK, context: CONTEXT })

    expect(resolved.templateSource).toBe('template')
    expect(resolved.templateId).toBe('recTpl1')
    // Markdown became HTML: `**in**` is emphasis and the paragraphs are paragraphs.
    expect(resolved.payload.html).toContain('<strong>in</strong>')
    expect(resolved.payload.html).toContain('<p>')
    // The merge fields resolved against the same context the code default would have used.
    expect(resolved.payload.html).toContain('Hi Ada,')
    expect(resolved.payload.html).not.toContain('the code default speaking')
  })

  it('renders a stored subject without HTML-escaping it, because a subject is a header', () => {
    const resolved = resolveTemplate({
      stored: template({ subject: '{{event.name}}: a decision on {{submission.code}}' }),
      fallback: FALLBACK,
      context: CONTEXT,
    })

    // "AI &amp; ML Summit" in a subject line is the bug this is guarding.
    expect(resolved.payload.subject).toBe('AI & ML Summit: a decision on SESS-1')
  })

  it('still escapes merge VALUES inside the body, since the body is HTML', () => {
    const resolved = resolveTemplate({
      stored: template({ bodyMarkdown: 'Title: {{submission.title}}' }),
      fallback: FALLBACK,
      context: {
        ...CONTEXT,
        submission: { code: 'SESS-1', title: '<script>alert(1)</script>' },
      },
    })

    expect(resolved.payload.html).not.toContain('<script>')
    expect(resolved.payload.html).toContain('&lt;script&gt;')
  })

  it('converts markdown BEFORE substituting, so a speaker cannot author markup', () => {
    // The other order would read the speaker's own text as markdown and turn their
    // asterisks into emphasis in an organizer's mail.
    const resolved = resolveTemplate({
      stored: template({ bodyMarkdown: 'From {{speaker.company}}.' }),
      fallback: FALLBACK,
      context: {
        ...CONTEXT,
        speaker: { ...CONTEXT.speaker, company: 'Acme *Labs*' },
      },
    })

    expect(resolved.payload.html).toContain('Acme *Labs*')
    expect(resolved.payload.html).not.toContain('<em>Labs</em>')
  })

  it('keeps the code subject when the stored row has only a body', () => {
    const resolved = resolveTemplate({
      stored: template({ subject: '   ' }),
      fallback: FALLBACK,
      context: CONTEXT,
    })

    expect(resolved.payload.subject).toBe(FALLBACK.subject)
    // The body still came from the row, so the label still says so.
    expect(resolved.templateSource).toBe('template')
  })
})

describe('resolveTemplate: the code template is the fallback', () => {
  it('sends the code body when the event has no row for the key', () => {
    const resolved = resolveTemplate({ stored: undefined, fallback: FALLBACK, context: CONTEXT })

    expect(resolved.templateSource).toBe('system')
    expect(resolved.templateId).toBeUndefined()
    expect(resolved.payload.html).toContain('the code default speaking')
    expect(resolved.payload.subject).toBe(FALLBACK.subject)
  })

  it('sends the code body when the row exists with an empty body', () => {
    // Airtable's `+` makes blank rows, and an organizer clears the editor to go back to the
    // built-in text. Neither may mail a blank page.
    const resolved = resolveTemplate({
      stored: template({ bodyMarkdown: '   \n  ' }),
      fallback: FALLBACK,
      context: CONTEXT,
    })

    expect(resolved.templateSource).toBe('system')
    expect(resolved.templateId).toBeUndefined()
    expect(resolved.payload.html).toContain('the code default speaking')
  })

  it('labels a body that came off the form as form_inline, not system', () => {
    // `Forms.confirmationEmailHtml` is a third provenance and the column has a value for
    // it, so the log can tell an organizer WHERE to go and change the body.
    const resolved = resolveTemplate({
      stored: undefined,
      fallback: FALLBACK,
      context: CONTEXT,
      fallbackSource: 'form_inline',
    })

    expect(resolved.templateSource).toBe('form_inline')
  })

  it('a stored row overrides even a form_inline fallback', () => {
    const resolved = resolveTemplate({
      stored: template(),
      fallback: FALLBACK,
      context: CONTEXT,
      fallbackSource: 'form_inline',
    })

    expect(resolved.templateSource).toBe('template')
  })
})

describe('resolveTemplate: failures the organizer has to hear about', () => {
  it('raises on a merge field the context cannot supply instead of quietly falling back', () => {
    // Falling back to the code body here would send plausible mail and leave the organizer
    // believing their template works. MAIL_MERGE_FIELD_UNKNOWN is permanent in the drain.
    expect(() =>
      resolveTemplate({
        stored: template({ bodyMarkdown: 'Hello {{speaker.nickname}}' }),
        fallback: FALLBACK,
        context: CONTEXT,
      }),
    ).toThrow(/speaker.nickname/)
  })

  it('does not let a stored template ask for a calendar invite', () => {
    // A row asking for an invite with no scheduled submission is a permanent
    // MAIL_ICS_INVALID (invite-attachment.ts), so this flag stays the sender's to set.
    const resolved = resolveTemplate({
      stored: template({ attachIcs: true }),
      fallback: FALLBACK,
      context: CONTEXT,
    })

    expect(resolved.payload.attachIcs).toBe(false)
  })
})
