// The confirmation email a submitter gets, and the `form_inline` label that says where its
// body came from.
//
// The enqueue is mocked because the subject is the ROW: `payloadJson` snapshots the message at
// enqueue time and the drain sends it verbatim (drain.ts), so what lands in this call is what
// lands in the submitter's inbox.
//
// `form_inline` had no writer at all before this trigger existed: the column declares three
// provenances and only `system` was ever used. This file pins the third, because the value of
// that label is that a reader can tell where to go and change the body.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Event, Speaker } from '@/types/domain'
import type { Form } from '@/types/forms'

import { form as formFixture } from './helpers/portal-fakes'

const mocks = vi.hoisted(() => ({ enqueueOutbox: vi.fn(() => Promise.resolve(1)) }))

vi.mock('@/features/submissions/decision-outbox', () => ({ enqueueOutbox: mocks.enqueueOutbox }))
vi.mock('@/utils/env', () => ({ appUrl: () => 'https://bodo.test' }))

const { sendSubmissionConfirmation } = await import('@/features/submissions/confirmation-email')

const EVENT: Event = {
  id: 'recEvent1',
  name: 'AI & ML Summit',
  slug: 'ai-ml-summit',
  eventType: 'in_person',
  timezone: 'UTC',
  status: 'open',
  accelSyncEnabled: false,
}

const SUBMITTER: Speaker = {
  id: 'recSpk1',
  firstName: 'Ada',
  lastName: 'Okafor',
  email: 'ada@example.com',
  links: {},
}

function input(overrides: { form?: Partial<Form>; reviewRequired?: boolean } = {}) {
  return {
    form: formFixture({
      confirmationEmailEnabled: true,
      confirmationEmailHtml: '<p>Thanks {{speaker.firstName}}, we have {{submission.code}}.</p>',
      ...overrides.form,
    }),
    event: EVENT,
    submissionId: 'recSub1',
    code: 'SESS-1',
    title: 'Evaluating agents',
    submitter: SUBMITTER,
    reviewRequired: overrides.reviewRequired ?? true,
  }
}

/** The single row the trigger queued. */
function queued() {
  const rows = mocks.enqueueOutbox.mock.calls.at(0)?.at(0) as
    | readonly {
        kind: string
        toEmail: string
        idempotencyKey: string
        templateSource: string
        formId?: string
        speakerId?: string
        payload: { subject: string; html: string; attachIcs: boolean }
      }[]
    | undefined
  expect(rows).toHaveLength(1)
  return rows?.[0]
}

beforeEach(() => {
  mocks.enqueueOutbox.mockClear()
})

describe('sendSubmissionConfirmation', () => {
  it("sends the ORGANIZER'S body off the form, labelled form_inline", async () => {
    await sendSubmissionConfirmation(input())
    const row = queued()

    // The one body in the system that is neither a code default nor an EmailTemplates row.
    expect(row?.templateSource).toBe('form_inline')
    expect(row?.payload.html).toContain('Thanks Ada, we have SESS-1.')
    expect(row?.kind).toBe('submission.confirmation')
    expect(row?.toEmail).toBe('ada@example.com')
  })

  it('appends the portal link, because that is the contract the editor states', async () => {
    // The editor's help text promises the sender appends it, so an organizer who deletes the
    // link from their body still sends a submitter something they can act on.
    await sendSubmissionConfirmation(input())
    expect(queued()?.payload.html).toContain('href="https://bodo.test/portal"')
  })

  it('links the row to the form and the recipient, so the Comms log can explain it', async () => {
    await sendSubmissionConfirmation(input())
    expect(queued()).toMatchObject({ formId: 'recForm1', speakerId: 'recSpk1' })
  })

  it('keys on the submission alone, so a retried submit queues nothing new', async () => {
    await sendSubmissionConfirmation(input())
    expect(queued()?.idempotencyKey).toBe('confirm:recSub1')
  })

  it('says "received" when the submission still needs review and "confirmed" when it does not', async () => {
    await sendSubmissionConfirmation(input({ reviewRequired: true }))
    // The TALK is named. A speaker who sent three proposals to one event used to get three
    // identical subjects and could not tell which had arrived.
    expect(queued()?.payload.subject).toBe('We received "Evaluating agents" for AI & ML Summit')

    mocks.enqueueOutbox.mockClear()
    await sendSubmissionConfirmation(input({ reviewRequired: false }))
    // Unescaped: a subject is a mail header, so "AI & ML Summit" must not arrive as "AI &amp;".
    expect(queued()?.payload.subject).toBe('"Evaluating agents" is confirmed for AI & ML Summit')
  })

  it('names the talk and its reference in the body, whatever the organizer wrote', async () => {
    // Appended by the sender, like the portal link: a confirmation that does not say what
    // was submitted is not a receipt, and the organizer's own body is not rewritten.
    await sendSubmissionConfirmation(input())
    const html = queued()?.payload.html ?? ''

    expect(html).toContain('Evaluating agents')
    expect(html).toContain('SESS-1')
  })

  it('falls back to a built-in body when the organizer emptied theirs', async () => {
    await sendSubmissionConfirmation(input({ form: { confirmationEmailHtml: '   ' } }))
    const row = queued()

    expect(row?.payload.html).toContain('We got your submission')
    // Still the form's own provenance: the body is absent from the form, not from a template.
    expect(row?.templateSource).toBe('form_inline')
  })

  it('queues nothing when the organizer switched the email off', async () => {
    await sendSubmissionConfirmation(input({ form: { confirmationEmailEnabled: false } }))
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled()
  })

  it('queues nothing when there is no address to send to', async () => {
    await sendSubmissionConfirmation({
      ...input(),
      submitter: { ...SUBMITTER, email: '  ' },
    })
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled()
  })

  it('does not let its own failure reach the submitter, who has already committed', async () => {
    // Raising here would show a landed submission as a failure and they would submit again,
    // with no key for the outbox to collapse the duplicate against.
    mocks.enqueueOutbox.mockRejectedValueOnce(new Error('airtable is having a day'))
    await expect(sendSubmissionConfirmation(input())).resolves.toBeUndefined()
  })

  it('still greets a submitter with no first name on file', async () => {
    await sendSubmissionConfirmation({
      ...input(),
      submitter: { ...SUBMITTER, firstName: '' },
    })
    expect(queued()?.payload.html).toContain('Thanks Okafor')
  })
})
