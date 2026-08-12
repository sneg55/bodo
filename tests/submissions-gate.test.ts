// The public CFP gate, which is the whole of "reject before rendering a single step"
// (BUILD_SPEC section 5.1). Four ways in and one way through, plus the banner copy the
// Welcome step is judged on.

import { describe, expect, it } from 'vitest'

import {
  deadlineSentence,
  resolveSubmissionLimit,
  submissionLimitSentence,
} from '@/features/submissions/banner'
import { PublicFormReasons, publicFormGate } from '@/features/submissions/gate'
import { submissionLifecycle } from '@/features/submissions/lifecycle'
import type { Event } from '@/types/domain'
import type { Form } from '@/types/forms'

const EVENT: Pick<Event, 'id' | 'slug'> = { id: 'ev1', slug: 'ai-engineer-sandbox' }

const FORM: Pick<Form, 'status' | 'closeDate' | 'eventId' | 'kind'> = {
  status: 'published',
  closeDate: '2026-09-15T23:59:00.000Z',
  eventId: 'ev1',
  kind: 'cfp',
}

const BEFORE = new Date('2026-08-08T12:00:00.000Z')
const AFTER = new Date('2026-09-16T00:00:00.000Z')

describe('publicFormGate', () => {
  it('opens a published cfp form for its own event before the close date', () => {
    expect(
      publicFormGate({ form: FORM, event: EVENT, eventSlug: EVENT.slug, now: BEFORE }),
    ).toEqual({ open: true })
  })

  it('tolerates a slug that was pasted with different case or whitespace', () => {
    expect(
      publicFormGate({
        form: FORM,
        event: EVENT,
        eventSlug: ' AI-Engineer-Sandbox ',
        now: BEFORE,
      }).open,
    ).toBe(true)
  })

  it('rejects a draft form', () => {
    expect(
      publicFormGate({
        form: { ...FORM, status: 'draft' },
        event: EVENT,
        eventSlug: EVENT.slug,
        now: BEFORE,
      }),
    ).toEqual({ open: false, reason: PublicFormReasons.NOT_PUBLISHED })
  })

  it('rejects a form whose event slug is not the one in the URL', () => {
    expect(
      publicFormGate({ form: FORM, event: EVENT, eventSlug: 'some-other-event', now: BEFORE }),
    ).toEqual({ open: false, reason: PublicFormReasons.WRONG_EVENT })
  })

  it('rejects a form linked to a different event than the one loaded', () => {
    expect(
      publicFormGate({
        form: { ...FORM, eventId: 'ev2' },
        event: EVENT,
        eventSlug: EVENT.slug,
        now: BEFORE,
      }),
    ).toEqual({ open: false, reason: PublicFormReasons.WRONG_EVENT })
  })

  it('rejects a task form, which is a portal surface and not a call for papers', () => {
    expect(
      publicFormGate({
        form: { ...FORM, kind: 'task' },
        event: EVENT,
        eventSlug: EVENT.slug,
        now: BEFORE,
      }),
    ).toEqual({ open: false, reason: PublicFormReasons.WRONG_EVENT })
  })

  it('rejects a form past its close date', () => {
    expect(publicFormGate({ form: FORM, event: EVENT, eventSlug: EVENT.slug, now: AFTER })).toEqual(
      { open: false, reason: PublicFormReasons.CLOSED },
    )
  })

  it('leaves a published form with no close date open', () => {
    expect(
      publicFormGate({
        form: { ...FORM, closeDate: undefined },
        event: EVENT,
        eventSlug: EVENT.slug,
        now: AFTER,
      }).open,
    ).toBe(true)
  })
})

describe('submissionLifecycle', () => {
  // BUILD_SPEC section 5.1b. The difference is whether the content goes through
  // review at all, so it is asserted rather than assumed.
  it('lands an abstract pending and marked for review', () => {
    expect(submissionLifecycle('abstracts')).toEqual({
      status: 'pending',
      reviewRequired: true,
      createsReviewRows: true,
    })
  })

  it('lands a session accepted, not for review, and with no review rows', () => {
    expect(submissionLifecycle('sessions')).toEqual({
      status: 'accepted',
      reviewRequired: false,
      createsReviewRows: false,
    })
  })
})

describe('banner copy', () => {
  // `now` is passed explicitly below rather than left to default to the wall clock. The
  // sentence gains a year once the deadline is not in the CURRENT one, so a defaulted `now`
  // would make these two assertions pass this year and fail on 2027-01-01: a test that breaks
  // on a date nobody is watching, in a suite nobody will be running for that reason.
  const DURING_2026 = new Date('2026-06-01T00:00:00.000Z')

  it('renders the deadline in the event timezone with its abbreviation', () => {
    // 2026-09-16T06:59Z is 11:59 PM on the 15th in Los Angeles, which is the sentence
    // ref 16 shows. The point of the timezone is that a speaker elsewhere reading
    // their own clock would submit a day late.
    expect(deadlineSentence('2026-09-16T06:59:00.000Z', 'America/Los_Angeles', DURING_2026)).toBe(
      'Form submissions will be accepted until September 15 at 11:59 PM PDT.',
    )
  })

  it('falls back to UTC rather than throwing on an unusable timezone', () => {
    const sentence = deadlineSentence('2026-09-16T06:59:00.000Z', 'Not/AZone', DURING_2026)
    expect(sentence).toBe('Form submissions will be accepted until September 16 at 6:59 AM UTC.')
  })

  it('has no deadline sentence for an unparseable close date', () => {
    expect(deadlineSentence('not a date', 'UTC')).toBeUndefined()
  })

  it('renders the submission limit verbatim', () => {
    expect(submissionLimitSentence(3)).toBe('Submission Limit: 3 submissions per user')
  })

  it('prefers the form override over the event default', () => {
    expect(resolveSubmissionLimit({ formLimit: 2, eventLimit: 5 })).toBe(2)
    expect(resolveSubmissionLimit({ eventLimit: 5 })).toBe(5)
    expect(resolveSubmissionLimit({})).toBeUndefined()
  })
})
