// Template rendering. Two properties are worth pinning: an unknown merge field is an
// error rather than a blank, and merged values are escaped.
//
// The blank case is the expensive one. A silent empty substitution means an organizer
// sends four hundred emails beginning "Hi ," and learns about it from a speaker, so a
// bad field has to fail at render time while the outbox row is still unwritten.

import { describe, expect, it } from 'vitest'

import { fieldsUsedBy, mergeFields, renderTemplate } from '@/features/comms/templates'

const CONTEXT = {
  speaker: { firstName: 'Ada', lastName: 'Okafor', email: 'ada@example.com', company: 'Northwind' },
  event: { name: 'AI Engineer Sandbox', slug: 'ai-engineer-sandbox', location: 'San Francisco' },
  submission: { code: 'SESS-1', title: 'Evaluating agents', room: 'Main Stage' },
  portalUrl: 'https://bodo.example.com/portal',
}

describe('renderTemplate', () => {
  it('substitutes every known field', () => {
    const out = renderTemplate('Hi {{speaker.firstName}}, {{submission.code}} is in.', CONTEXT)
    expect(out).toBe('Hi Ada, SESS-1 is in.')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('Hi {{ speaker.firstName }}', CONTEXT)).toBe('Hi Ada')
  })

  it('substitutes a field used more than once', () => {
    expect(renderTemplate('{{event.name}} / {{event.name}}', CONTEXT)).toBe(
      'AI Engineer Sandbox / AI Engineer Sandbox',
    )
  })

  it('throws and names the field when a template references something absent', () => {
    // The whole point: fail here rather than sending "Hi ,".
    expect(() => renderTemplate('Hi {{speaker.nickname}}', CONTEXT)).toThrow(/speaker\.nickname/)
  })

  it('names every missing field at once, so one fix round covers them all', () => {
    expect(() => renderTemplate('{{a.b}} {{c.d}}', CONTEXT)).toThrow(/a\.b, c\.d/)
  })

  it('treats an optional context field as missing rather than blank', () => {
    // submission is absent from this context, so a template that assumes it must fail.
    const { submission: _omitted, ...withoutSubmission } = CONTEXT
    expect(() => renderTemplate('{{submission.title}}', withoutSubmission)).toThrow(
      /submission\.title/,
    )
  })

  it('escapes merged values, because a speaker controls their own name', () => {
    const hostile = {
      ...CONTEXT,
      speaker: { ...CONTEXT.speaker, firstName: '<script>alert(1)</script>' },
    }

    const out = renderTemplate('Hi {{speaker.firstName}}', hostile)

    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('escapes quotes, which would otherwise break out of an attribute', () => {
    const hostile = { ...CONTEXT, speaker: { ...CONTEXT.speaker, lastName: '" onload="x' } }
    expect(renderTemplate('<a title="{{speaker.lastName}}">x</a>', hostile)).not.toContain(
      '" onload=',
    )
  })

  it('leaves template markup that is not a merge field alone', () => {
    expect(renderTemplate('{ not a field } {{{event.name}}}', CONTEXT)).toContain('{ not a field }')
  })

  it('renders a template with no fields unchanged', () => {
    expect(renderTemplate('<p>Thanks for submitting.</p>', CONTEXT)).toBe(
      '<p>Thanks for submitting.</p>',
    )
  })
})

describe('mergeFields', () => {
  it('omits empty values so they read as missing rather than blank', () => {
    const context = { ...CONTEXT, speaker: { ...CONTEXT.speaker, company: '' } }
    expect(mergeFields(context).has('speaker.company')).toBe(false)
  })

  it('does not expose anything outside the declared context', () => {
    // A merge field must not be able to reach a prototype member or a function.
    const fields = mergeFields(CONTEXT)
    for (const key of ['constructor', 'toString', '__proto__', 'speaker']) {
      expect(fields.has(key)).toBe(false)
    }
  })
})

describe('fieldsUsedBy', () => {
  it('lists the fields a template references, for validating it before it is saved', () => {
    expect(fieldsUsedBy('Hi {{speaker.firstName}}, see {{portalUrl}}')).toEqual([
      'speaker.firstName',
      'portalUrl',
    ])
  })

  it('returns nothing for a template with no fields', () => {
    expect(fieldsUsedBy('<p>Plain</p>')).toEqual([])
  })
})
