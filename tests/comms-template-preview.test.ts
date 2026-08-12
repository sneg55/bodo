// What the template editor's preview shows, and that it is the same render the mail gets.
//
// The claim SPK-14 is about is narrow and easy to fake: an organizer must be able to see
// `{{speaker.firstName}}` resolved to a name before they save. What makes a preview worth
// having is that it goes through `resolveTemplate`, the function every trigger sends
// through, so the assertions here are mostly about INHERITED behaviour - the blank-body
// fallback, the blank-subject fallback, markdown before merge, escaping, and an unknown
// field failing loudly. A preview with its own substitution path would pass a test that only
// checked "the name appears".
//
// The other half is the loader's order: it reads a real speaker's name and address off the
// roster, so it is a read that authorizes first. The ROLE rule itself is pinned next door in
// comms-template-authorization.test.ts and is not restated here.

import { describe, expect, it } from 'vitest'

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import {
  ADMIN_TEMPLATES,
  type AdminTemplateMeta,
  editableTemplateFor,
  TEMPLATE_KEYS,
} from '@/features/comms/template-keys'
import {
  type PreviewPerson,
  previewLinkUrl,
  previewTemplate,
  SAMPLE_PERSON,
} from '@/features/comms/template-preview'
import {
  previewAdminTemplate,
  type TemplatePreviewDeps,
} from '@/features/comms/template-preview-load'
import { mergeFields } from '@/features/comms/templates'

const EVENT = { name: 'AI & ML Summit', slug: 'ai-ml-summit' }
const ADA: PreviewPerson = {
  firstName: 'Grace',
  lastName: 'Hopper',
  email: 'grace@example.org',
  company: 'Northwind',
}

function metaFor(key: string): AdminTemplateMeta {
  const meta = editableTemplateFor(key)
  if (meta === undefined) throw new Error(`no such editable template: ${key}`)
  return meta
}

const INVITE = metaFor(TEMPLATE_KEYS.speakerInvite)
const ADMIN_NEW = metaFor(TEMPLATE_KEYS.adminNew)

function preview(overrides: {
  meta?: AdminTemplateMeta
  subject?: string
  bodyMarkdown?: string
  recipient?: PreviewPerson
}) {
  return previewTemplate({
    meta: overrides.meta ?? INVITE,
    subject: overrides.subject ?? 'Your {{event.name}} speaker portal',
    bodyMarkdown: overrides.bodyMarkdown ?? 'Hi {{speaker.firstName}},',
    event: EVENT,
    recipient: overrides.recipient,
    portalUrl: 'https://bodo.test/portal',
  })
}

describe('previewTemplate: the merge fields come back resolved', () => {
  it('renders a real speaker name in place of the token', () => {
    const result = preview({ recipient: ADA })

    expect(result.html).toContain('Hi Grace,')
    expect(result.html).not.toContain('{{speaker.firstName}}')
    expect(result.toEmail).toBe('grace@example.org')
    expect(result.sampleRecipient).toBe(false)
  })

  it('resolves the subject too, and does not escape it', () => {
    // A subject is a mail header, so the event's ampersand must survive as itself. This is
    // `renderSubject` being inherited rather than reimplemented; see templates.ts.
    expect(preview({ recipient: ADA }).subject).toBe('Your AI & ML Summit speaker portal')
  })

  it('escapes merge values in the BODY, because that is HTML', () => {
    const result = preview({
      recipient: { ...ADA, company: 'Acme & Co' },
      bodyMarkdown: 'From {{speaker.company}}',
    })

    expect(result.html).toContain('Acme &amp; Co')
  })

  it('labels the render as the organizer body when the editor has one', () => {
    expect(preview({ recipient: ADA }).source).toBe('template')
  })

  it('falls back to the sample person when the roster supplied nobody', () => {
    const result = preview({})

    expect(result.html).toContain(`Hi ${SAMPLE_PERSON.firstName},`)
    expect(result.toEmail).toBe(SAMPLE_PERSON.email)
    expect(result.sampleRecipient).toBe(true)
  })

  it('fills a real speaker with no company from the sample, rather than failing', () => {
    // An absent value is a hole `renderTemplate` throws on, and throwing there would tell
    // the organizer their TEMPLATE is broken when it is the roster row that is thin.
    const result = preview({
      recipient: { firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.org' },
      bodyMarkdown: '{{speaker.firstName}} of {{speaker.company}}',
    })

    expect(result.html).toContain(`Grace of ${SAMPLE_PERSON.company ?? ''}`)
  })
})

describe('previewTemplate: it inherits the resolution rules the senders use', () => {
  it('previews the BUILT-IN body when the editor body is blank, and says so', () => {
    const result = preview({ bodyMarkdown: '   ', recipient: ADA })

    expect(result.source).toBe('system')
    // The invite's built-in opening, resolved. Clearing the box is how an organizer goes
    // back to it, so the preview has to show what would then be sent.
    expect(result.html).toContain('Hi Grace,')
    expect(result.html).toContain('You have a speaker portal for')
  })

  it('falls back to the built-in SUBJECT on its own, body kept', () => {
    const result = preview({
      subject: '',
      bodyMarkdown: 'Hi {{speaker.firstName}},',
      recipient: ADA,
    })

    expect(result.subject).toBe('Your AI & ML Summit speaker portal')
    expect(result.source).toBe('template')
  })

  it('converts markdown first, so a speaker’s own text is not read as markdown', () => {
    const result = preview({
      recipient: { ...ADA, company: 'Acme *Labs*' },
      bodyMarkdown: '**Bold** from {{speaker.company}}',
    })

    expect(result.html).toContain('<strong>Bold</strong>')
    expect(result.html).toContain('Acme *Labs*')
    expect(result.html).not.toContain('<em>Labs</em>')
  })

  it('restores a merge token inside a link destination', () => {
    // The percent-encoding defect markdown-email.ts documents: the anchor text was
    // substituted and the href was not, so the mail read correctly and linked nowhere. A
    // preview that did not go through the same conversion would not show it.
    const result = preview({ bodyMarkdown: '[{{portalUrl}}]({{portalUrl}})', recipient: ADA })

    expect(result.html).toContain('href="https://bodo.test/portal"')
    expect(result.html).not.toContain('%7B%7B')
  })

  it('throws MAIL_MERGE_FIELD_UNKNOWN, naming the field, for a token that does not exist', () => {
    // The most useful thing this preview does: the same failure the drain treats as
    // permanent, surfaced before the template is saved instead of per recipient afterwards.
    try {
      preview({ bodyMarkdown: 'Hi {{speaker.nickname}},', recipient: ADA })
      expect.unreachable('a bad merge field must not render')
    } catch (error) {
      expect(isAppError(error) ? error.id : error).toBe(ErrorIds.MAIL_MERGE_FIELD_UNKNOWN)
      expect(String(error)).toContain('speaker.nickname')
    }
  })
})

describe('previewTemplate: everything the save accepts, it can render', () => {
  // `saveAdminTemplate` validates a body against `mergeFields` with every optional value
  // populated (template-write.ts `assertMergeFields`). If the preview context is any
  // thinner, the preview starts refusing merge fields that save cleanly and send fine,
  // which is the one way a preview can be actively harmful.
  const allowed = [
    ...mergeFields({
      speaker: { firstName: 'a', lastName: 'a', email: 'a', company: 'a' },
      event: { name: 'a', slug: 'a', startsAt: 'a', location: 'a' },
      submission: { code: 'a', title: 'a', startsAt: 'a', room: 'a' },
      task: { title: 'a', dueAt: 'a' },
      portalUrl: 'a',
      magicLink: 'a',
    }).keys(),
  ]

  it.each(allowed)('renders {{%s}}', (field) => {
    const result = preview({ bodyMarkdown: `value: {{${field}}}`, recipient: ADA })

    expect(result.html).not.toContain('{{')
  })
})

describe('previewLinkUrl', () => {
  it('points a speaker email at the portal', () => {
    expect(previewLinkUrl(INVITE, 'https://bodo.test', 'recEvent1')).toBe(
      'https://bodo.test/portal',
    )
  })

  it('points an admin alert at the admin app, as its sender does', () => {
    expect(previewLinkUrl(ADMIN_NEW, 'https://bodo.test', 'recEvent1')).toBe(
      'https://bodo.test/admin/recEvent1/abstracts',
    )
  })

  it('covers every admin template, so a new one cannot silently link to the portal', () => {
    for (const meta of ADMIN_TEMPLATES) {
      expect(previewLinkUrl(meta, 'https://bodo.test', 'recEvent1')).toContain('/admin/')
    }
  })
})

/** Records every call, so "was anything read" is answerable. */
function spyDeps(requireAdmin: TemplatePreviewDeps['requireAdmin']) {
  const reads: string[] = []
  const deps: TemplatePreviewDeps = {
    requireAdmin,
    getEvent: (eventId) => {
      reads.push(`event:${eventId}`)
      return Promise.resolve(EVENT)
    },
    listSpeakers: (eventId) => {
      reads.push(`speakers:${eventId}`)
      return Promise.resolve([{ ...ADA, email: '' }, ADA])
    },
    appOrigin: () => 'https://bodo.test',
  }
  return { deps, reads }
}

/** The id of whatever was thrown, so a refusal is asserted by cause and not by message. */
async function errorIdOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'nothing thrown'
  } catch (error) {
    return isAppError(error) ? error.id : `not an AppError: ${String(error)}`
  }
}

const OK: TemplatePreviewDeps['requireAdmin'] = () => Promise.resolve()
const REFUSED: TemplatePreviewDeps['requireAdmin'] = () =>
  Promise.reject(new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'not an admin of this event'))

const INPUT = {
  eventId: 'recEventA',
  key: TEMPLATE_KEYS.speakerInvite,
  subject: 'Your {{event.name}} speaker portal',
  bodyMarkdown: 'Hi {{speaker.firstName}},',
}

describe('previewAdminTemplate', () => {
  it('addresses the first roster speaker who has an email', async () => {
    const { deps, reads } = spyDeps(OK)

    const result = await previewAdminTemplate(deps, INPUT)

    expect(result.toEmail).toBe('grace@example.org')
    expect(result.sampleRecipient).toBe(false)
    expect(result.html).toContain('Hi Grace,')
    expect(reads).toEqual(['event:recEventA', 'speakers:recEventA'])
  })

  it('renders against the sample person when the roster is empty', async () => {
    const { deps } = spyDeps(OK)

    const result = await previewAdminTemplate(
      { ...deps, listSpeakers: () => Promise.resolve([]) },
      INPUT,
    )

    expect(result.sampleRecipient).toBe(true)
    expect(result.toEmail).toBe(SAMPLE_PERSON.email)
  })

  it('refuses before reading anything', async () => {
    // A rendered body is the mail this event's speakers receive, and the roster read hands
    // back a real name and address. A guard that ran after the read would be decoration.
    const { deps, reads } = spyDeps(REFUSED)

    await expect(previewAdminTemplate(deps, INPUT)).rejects.toThrow()
    expect(reads).toEqual([])
  })

  it('refuses a key that is not editable, and reads nothing', async () => {
    const { deps, reads } = spyDeps(OK)

    expect(
      await errorIdOf(() => previewAdminTemplate(deps, { ...INPUT, key: 'custom-invented' })),
    ).toBe(ErrorIds.MAIL_TEMPLATE_MISSING)
    expect(reads).toEqual([])
  })
})
