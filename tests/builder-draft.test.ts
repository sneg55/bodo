// Editor state to stored field array, and back.
//
// The single most important assertion in this file is the `registryKey` one. That key is
// what routes an answer into a typed Airtable column, it was once silently stripped by
// `formFieldSchema`, and the consequence was every CFP submission landing as "Untitled
// submission" with format, level, language, ceuCredits, trackId and tagIds all empty. A
// builder that drops it on save reproduces that bug from the other end, so the transform
// is pinned here and the round trip through the real Zod schema is pinned too.

import { describe, expect, it } from 'vitest'

import {
  draftFromForm,
  type FormDraft,
  normalizeFields,
  toFormWrite,
} from '@/features/forms/builder/draft'
import { EMPTY_FORM_HEADINGS } from '@/features/forms/builder/headings'
import { formFieldsSchema } from '@/services/airtable/schemas'
import type { Form, FormField } from '@/types/forms'

/** The EVENT's zone: a close date is a wall-clock deadline in it, not in the runtime's. */
const ZONE = 'America/Los_Angeles'

const FORMAT: FormField = {
  id: 'f_format',
  type: 'select',
  label: 'Format',
  required: true,
  registryKey: 'format',
  options: [
    { value: 'talk', label: 'Talk' },
    { value: 'workshop', label: 'Workshop' },
  ],
}

const LAB: FormField = {
  id: 'f_lab',
  type: 'text',
  label: 'Lab setup requirements',
  required: true,
  maxLen: 255,
  showIf: { fieldId: 'f_format', op: 'eq', value: 'workshop' },
}

function draft(overrides: Partial<FormDraft> = {}): FormDraft {
  return {
    // The heading fields are not what these tests are about, and `FormDraft` requires
    // all eight, so the empty set stands in.
    ...EMPTY_FORM_HEADINGS,
    name: 'Session Submission Form',
    entityKind: 'abstracts',
    participantsEnabled: true,
    welcomeEnabled: true,
    welcomeHtml: '<p>hello</p>',
    successHtml: '',
    fields: [FORMAT, LAB],
    participantFields: [],
    routing: { rules: [], defaultTrackId: undefined },
    roles: [{ role: 'speaker', enabled: true, min: 1, max: 1 }],
    crossFieldLimits: [],
    closeDate: '',
    submissionLimitEnabled: false,
    submissionLimit: '',
    allowMultipleDrafts: false,
    autoRedirectToPortal: true,
    confirmationEmailEnabled: true,
    confirmationEmailHtml: '',
    adminAlertOnNew: [],
    adminAlertOnUpdate: [],
    ...overrides,
  }
}

describe('toFormWrite', () => {
  it('keeps registryKey on every field it writes', () => {
    const write = toFormWrite(draft(), ZONE)

    expect(write.fields.at(0)?.registryKey).toBe('format')
  })

  it('survives the Zod schema the DAL parses stored fields with', () => {
    const write = toFormWrite(draft(), ZONE)
    const parsed = formFieldsSchema.parse(JSON.parse(JSON.stringify(write.fields)))

    expect(parsed.at(0)?.registryKey).toBe('format')
    expect(parsed.at(1)?.showIf).toEqual({ fieldId: 'f_format', op: 'eq', value: 'workshop' })
  })

  it('trims the form name and turns a blank rich text body into absence', () => {
    const write = toFormWrite(draft({ name: '  Form #4  ', successHtml: '   ' }), ZONE)

    expect(write.name).toBe('Form #4')
    expect(write.successHtml).toBeUndefined()
  })

  it('drops the welcome body when the Show message toggle is off', () => {
    expect(toFormWrite(draft({ welcomeEnabled: false }), ZONE).welcomeHtml).toBeUndefined()
  })

  it('forces required on a locked field whatever the stored flag said', () => {
    const locked: FormField = { ...FORMAT, locked: true, required: false }

    expect(toFormWrite(draft({ fields: [locked] }), ZONE).fields.at(0)?.required).toBe(true)
  })

  it('stores no submission limit while the toggle is off, even with a number typed', () => {
    const write = toFormWrite(draft({ submissionLimitEnabled: false, submissionLimit: '3' }), ZONE)

    expect(write.submissionLimit).toBeUndefined()
  })

  it('reads the limit as an integer when the toggle is on and refuses zero', () => {
    expect(
      toFormWrite(draft({ submissionLimitEnabled: true, submissionLimit: '3' }), ZONE)
        .submissionLimit,
    ).toBe(3)
    expect(
      toFormWrite(draft({ submissionLimitEnabled: true, submissionLimit: '0' }), ZONE)
        .submissionLimit,
    ).toBeUndefined()
  })

  it('turns the close date input into an instant and an empty one into no deadline', () => {
    expect(toFormWrite(draft({ closeDate: '' }), ZONE).closeDate).toBeUndefined()
    // Exact, not a range. It used to be asserted loosely because the conversion read the
    // RUNTIME's zone, which is UTC on Workers, so the answer depended on where it ran and a
    // California event's 5pm deadline was stored as 5pm UTC (10am there). 17:00 on Sep 15 in
    // America/Los_Angeles is PDT, UTC-7, so the instant is midnight UTC on the 16th.
    expect(toFormWrite(draft({ closeDate: '2026-09-15T17:00' }), ZONE).closeDate).toBe(
      '2026-09-16T00:00:00.000Z',
    )
  })

  it('drops the participant questions rather than normalizing them when the step is off', () => {
    const write = toFormWrite(
      draft({ participantsEnabled: false, participantFields: [{ ...FORMAT, id: 'p1' }] }),
      ZONE,
    )

    expect(write.participantsEnabled).toBe(false)
    expect(write.participantFields).toHaveLength(1)
  })

  it('clamps a role whose max is below its min', () => {
    const write = toFormWrite(
      draft({ roles: [{ role: 'co_speaker', enabled: true, min: 3, max: 1 }] }),
      ZONE,
    )

    expect(write.roles.at(0)).toEqual({ role: 'co_speaker', enabled: true, min: 3, max: 3 })
  })

  it('drops routing rules whose question or track is gone', () => {
    const write = toFormWrite(
      draft({
        routing: {
          rules: [
            { when: { fieldId: 'f_format', op: 'eq', value: 'workshop' }, trackId: 'recInfra' },
            { when: { fieldId: 'f_deleted', op: 'eq', value: 'x' }, trackId: 'recInfra' },
            { when: { fieldId: 'f_format', op: 'eq', value: 'talk' }, trackId: '  ' },
          ],
          defaultTrackId: '',
        },
      }),
      ZONE,
    )

    expect(write.routing.rules).toHaveLength(1)
    expect(write.routing.defaultTrackId).toBeUndefined()
  })

  it('drops empty admin recipients instead of storing a blank address', () => {
    const write = toFormWrite(draft({ adminAlertOnNew: [' a@b.co ', '  '] }), ZONE)

    expect(write.adminAlertOnNew).toEqual(['a@b.co'])
  })
})

describe('normalizeFields', () => {
  it('drops a showIf pointing at a question that is no longer on the form', () => {
    // `visibleFields` deliberately SHOWS such a field rather than hiding it, so the dead
    // rule is invisible at render time. Persisting it would leave the next organizer
    // looking at a rule with no controller.
    const fields = normalizeFields([LAB])

    expect(fields.at(0)?.showIf).toBeUndefined()
  })

  it('drops a showIf that points at the field itself', () => {
    const selfRef: FormField = { ...LAB, showIf: { fieldId: 'f_lab', op: 'answered' } }

    expect(normalizeFields([FORMAT, selfRef]).at(1)?.showIf).toBeUndefined()
  })

  it('drops options from a type that has none and blank options from one that does', () => {
    const messy: FormField[] = [
      {
        ...FORMAT,
        options: [
          { value: ' talk ', label: '' },
          { value: '  ', label: 'Nothing' },
        ],
      },
      {
        id: 't',
        type: 'text',
        label: 'Title',
        required: true,
        options: [{ value: 'x', label: 'X' }],
      },
    ]
    const fields = normalizeFields(messy)

    expect(fields.at(0)?.options).toEqual([{ value: 'talk', label: 'talk' }])
    expect(fields.at(1)?.options).toBeUndefined()
  })

  it('drops a help string that is only whitespace', () => {
    expect(normalizeFields([{ ...FORMAT, help: '  ' }]).at(0)?.help).toBeUndefined()
  })
})

describe('draftFromForm', () => {
  it('shows the welcome message toggle as on only when a body was stored', () => {
    const base = {
      fields: [],
      participantFields: [],
      routing: { rules: [] },
      roles: [],
      crossFieldLimits: [],
      adminAlertOnNew: [],
      adminAlertOnUpdate: [],
    }
    const withBody = { ...base, welcomeHtml: '<p>hi</p>' } as unknown as Form
    const without = { ...base } as unknown as Form

    expect(draftFromForm(withBody, ZONE).welcomeEnabled).toBe(true)
    expect(draftFromForm(without, ZONE).welcomeEnabled).toBe(false)
  })

  it('round-trips a submission limit through the text control', () => {
    const form = {
      name: 'F',
      entityKind: 'abstracts',
      fields: [],
      participantFields: [],
      routing: { rules: [] },
      roles: [],
      crossFieldLimits: [],
      submissionLimit: 3,
      adminAlertOnNew: [],
      adminAlertOnUpdate: [],
    } as unknown as Form
    const back = toFormWrite(draftFromForm(form, ZONE), ZONE)

    expect(back.submissionLimit).toBe(3)
  })
})

describe('normalization that used to break a live form, all found by Codex review', () => {
  it('trims a condition value with the same rule as the option it matches', () => {
    // Saving trims option values. It did NOT trim the condition values that match them, so
    // a rule written against " workshop " stopped matching once the option became
    // "workshop": the conditional field was simply never shown again, with no error.
    const write = toFormWrite(
      draft({
        fields: [
          { ...FORMAT, options: [{ value: '  workshop  ', label: 'Workshop' }] },
          { ...LAB, showIf: { fieldId: 'f_format', op: 'eq', value: '  workshop  ' } },
        ],
      }),
      ZONE,
    )

    expect(write.fields.at(0)?.options?.at(0)?.value).toBe('workshop')
    expect(write.fields.at(1)?.showIf?.value).toBe('workshop')
  })

  it('trims every value of a multi-value condition', () => {
    const write = toFormWrite(
      draft({
        fields: [
          FORMAT,
          { ...LAB, showIf: { fieldId: 'f_format', op: 'in', value: [' talk ', 'workshop '] } },
        ],
      }),
      ZONE,
    )

    expect(write.fields.at(1)?.showIf?.value).toEqual(['talk', 'workshop'])
  })

  it('treats an empty rich text document as no message at all', () => {
    // TipTap represents a cleared editor as `<p></p>`, which is not whitespace, so deleting
    // every character stored that markup: the form reloaded with "Show message" still on and
    // the public wizard's own default welcome copy suppressed by an empty paragraph.
    expect(
      toFormWrite(draft({ welcomeEnabled: true, welcomeHtml: '<p></p>' }), ZONE).welcomeHtml,
    ).toBeUndefined()
    expect(
      toFormWrite(draft({ welcomeEnabled: true, welcomeHtml: '<p><br></p>' }), ZONE).welcomeHtml,
    ).toBeUndefined()
    expect(
      toFormWrite(draft({ welcomeEnabled: true, welcomeHtml: '<p>&nbsp;</p>' }), ZONE).welcomeHtml,
    ).toBeUndefined()
  })

  it('keeps rich text that has actual content, markup and all', () => {
    const html = '<p>Tell us about <strong>your</strong> session.</p>'

    expect(toFormWrite(draft({ welcomeEnabled: true, welcomeHtml: html }), ZONE).welcomeHtml).toBe(
      html,
    )
  })
})

describe('toFormWrite, alert recipients', () => {
  // `adminAlertOnNew` and `adminAlertOnUpdate` feed `adminAlertRows`, so whatever survives the
  // write path is handed to the email provider later. `MemberPicker` refuses a malformed address
  // in the browser, but a Server Action takes its whole draft from the caller, so the client is
  // not a check on a POST. Found by Codex review.
  it('drops a value that is not an address', () => {
    const write = toFormWrite(
      draft({ adminAlertOnNew: ['chair@example.com', 'not-an-address', 'nope@localhost'] }),
      ZONE,
    )

    expect(write.adminAlertOnNew).toEqual(['chair@example.com'])
  })

  it('normalizes case, because one mailbox must not become two outbox rows', () => {
    const write = toFormWrite(
      draft({ adminAlertOnUpdate: ['  Sam@Example.com ', 'sam@example.com'] }),
      ZONE,
    )

    expect(write.adminAlertOnUpdate).toEqual(['sam@example.com'])
  })

  it('keeps an external address, which is a legitimate recipient', () => {
    // The column stores addresses rather than member links on purpose: alerting a shared
    // `cfp@` mailbox that belongs to nobody on the team is a real thing organizers do.
    expect(
      toFormWrite(draft({ adminAlertOnNew: ['cfp@conference.example'] }), ZONE).adminAlertOnNew,
    ).toEqual(['cfp@conference.example'])
  })
})
