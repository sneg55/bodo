// The write direction for the tables added for tasks, files, the outbox, and rounds,
// plus the two submission builders whose rules are decisions rather than plumbing.
//
// What is asserted here is mostly the difference between an ABSENT key and a `null`
// one, because that difference is invisible in review and permanent in the data: an
// absent key leaves the old value in place, `null` clears it, and picking the wrong one
// is how a reopened task keeps claiming it was completed on Tuesday.

import { describe, expect, it } from 'vitest'
import { speakerFields, statusFields, submissionEditFields } from '@/services/airtable/to-fields'
import {
  fileFields,
  outboxFields,
  outboxOutcomeFields,
  submissionRoundFields,
  taskAnswersFields,
  taskAssignmentUpdateFields,
} from '@/services/airtable/to-fields-portal'

const NOW = '2026-08-08T09:00:00.000Z'

describe('speakerFields', () => {
  // The single worst defect found in the eval run: saving a speaker profile failed
  // outright, including a save that changed nothing, because a `<form>` posts every
  // input and an untouched optional select arrived as `''`. Airtable read that as a
  // request to create a choice named empty string, refused it, and rejected the whole
  // PATCH, so the bio, the headshot and every link went with it.
  it('sends null, not an empty string, for a field the speaker cleared', () => {
    const fields = speakerFields({
      email: 'ada@example.com',
      gender: '',
      pronouns: '',
      bio: '<p>Builds evals.</p>',
    })

    expect(fields.gender).toBeNull()
    expect(fields.pronouns).toBeNull()
    expect(fields.bio).toBe('<p>Builds evals.</p>')
  })

  it('still omits a field the form never asked about', () => {
    // The other half of the contract: absent means "leave the column alone", so a form
    // with no bio field cannot wipe a returning speaker's bio.
    const fields = speakerFields({ email: 'ada@example.com' })

    expect(Object.keys(fields)).toEqual(['email'])
  })

  it('never clears the email, which is the identity every other row links on', () => {
    expect(speakerFields({ email: '' }).email).toBe('')
  })
})

describe('taskAssignmentUpdateFields', () => {
  it('stamps completedAt when a task is finished', () => {
    const fields = taskAssignmentUpdateFields({ status: 'done', completedAt: NOW })
    expect(fields).toEqual({ status: 'done', completedAt: NOW })
  })

  it('CLEARS completedAt when a task is reopened', () => {
    const fields = taskAssignmentUpdateFields({ status: 'pending' })
    // `null`, not absent. Omitting the key would leave a pending row still carrying the
    // instant it was completed, and the admin count and the portal would disagree.
    expect(fields).toEqual({ status: 'pending', completedAt: null })
  })

  it('writes answers only for a task that has them', () => {
    expect(taskAssignmentUpdateFields({ status: 'done', completedAt: NOW })).not.toHaveProperty(
      'answersJson',
    )
    // A `link` or `confirm` task collects no evidence, and clearing the column would
    // wipe what a form task had already saved.
    expect(
      taskAssignmentUpdateFields({ status: 'done', completedAt: NOW, answers: { fld_av: 'HDMI' } })
        .answersJson,
    ).toBe('{"fld_av":"HDMI"}')
  })

  it('serializes an empty answer set rather than omitting it', () => {
    expect(taskAnswersFields({}).answersJson).toBe('{}')
  })
})

describe('fileFields', () => {
  const draft = {
    speakerId: 'recSpk1',
    kind: 'slides' as const,
    objectKey: 'slides/recSpk1/deck.pdf',
    visibility: 'private' as const,
    contentType: 'application/pdf',
    filename: 'deck.pdf',
    size: 4096,
    uploadedAt: NOW,
    verifiedAt: NOW,
  }

  it('sends every link as an array, even when it holds one id', () => {
    const fields = fileFields({ ...draft, submissionId: 'recSub1' })
    expect(fields.speaker).toEqual(['recSpk1'])
    expect(fields.submission).toEqual(['recSub1'])
    expect(fields.objectKey).toBe('slides/recSpk1/deck.pdf')
  })

  it('omits the optional links rather than clearing them', () => {
    const fields = fileFields(draft)
    expect(fields).not.toHaveProperty('submission')
    expect(fields).not.toHaveProperty('fileRequestAssignment')
  })

  it('carries verifiedAt only when the bytes were confirmed', () => {
    // A row that claims bytes nobody HEADed is the one thing section 5.2 forbids.
    const { verifiedAt: _unused, ...unverified } = draft
    expect(fileFields(unverified)).not.toHaveProperty('verifiedAt')
    expect(fileFields(draft).verifiedAt).toBe(NOW)
  })

  it('stores no url, so the bucket domain stays changeable', () => {
    expect(Object.keys(fileFields(draft))).not.toContain('url')
  })
})

describe('outboxFields', () => {
  const draft = {
    eventId: 'recEvent1',
    templateSource: 'template' as const,
    templateId: 'recTpl1',
    speakerId: 'recSpk1',
    idempotencyKey: 'accepted:recSub1:2026-08-06T12:00:00.000Z',
    payload: { subject: 'You are in', html: '<p>Congratulations</p>', attachIcs: true },
    toEmail: 'ada@example.com',
    sendAt: NOW,
  }

  it('snapshots the rendered message as the payload', () => {
    const fields = outboxFields(draft)
    // Snapshotted, not referenced: a template edited between queueing and sending must
    // not change mail that was already promised. Section 5.3.
    expect(fields.payloadJson).toBe(
      '{"subject":"You are in","html":"<p>Congratulations</p>","attachIcs":true}',
    )
    expect(fields.toEmail).toBe('ada@example.com')
    expect(fields.idempotencyKey).toBe(draft.idempotencyKey)
  })

  it('creates the row queued with no attempts behind it', () => {
    const fields = outboxFields(draft)
    expect(fields.status).toBe('queued')
    expect(fields.attempts).toBe(0)
  })

  it('omits the links a system message does not have', () => {
    const fields = outboxFields({
      ...draft,
      templateId: undefined,
      templateSource: 'system',
      speakerId: undefined,
    })
    expect(fields).not.toHaveProperty('template')
    expect(fields).not.toHaveProperty('speaker')
    expect(fields.templateSource).toBe('system')
  })
})

describe('outboxOutcomeFields', () => {
  it('releases the lease on a terminal row', () => {
    const fields = outboxOutcomeFields({
      status: 'sent',
      attempts: 1,
      sentAt: NOW,
      providerMessageId: 'msg_1',
    })
    // Cleared rather than omitted: a `sent` row still carrying a leaseHolder leaves a
    // later reader unable to tell whether a crashed worker is still going.
    expect(fields.leaseHolder).toBeNull()
    expect(fields.leaseExpiresAt).toBeNull()
    expect(fields.sentAt).toBe(NOW)
    expect(fields.providerMessageId).toBe('msg_1')
  })

  it('records a claim as status and lease columns, which grant nothing', () => {
    const fields = outboxOutcomeFields({
      status: 'sending',
      attempts: 1,
      leaseHolder: 'worker-7',
      leaseExpiresAt: '2026-08-08T09:01:00.000Z',
    })
    expect(fields.status).toBe('sending')
    expect(fields.leaseHolder).toBe('worker-7')
    // No sentAt and no error yet, and neither is cleared: absent means "no news", so a
    // retry does not erase the provider id from the attempt before it.
    expect(fields).not.toHaveProperty('sentAt')
    expect(fields).not.toHaveProperty('lastError')
  })

  it('keeps a failure inspectable without clobbering the provider id', () => {
    const fields = outboxOutcomeFields({ status: 'failed', attempts: 2, lastError: 'timeout' })
    expect(fields.lastError).toBe('timeout')
    expect(fields).not.toHaveProperty('providerMessageId')
  })
})

describe('submissionRoundFields', () => {
  it('enters a round as pending by default', () => {
    const fields = submissionRoundFields({
      submissionId: 'recSub1',
      roundId: 'recRnd1',
      enteredAt: NOW,
    })
    expect(fields).toEqual({
      submission: ['recSub1'],
      round: ['recRnd1'],
      status: 'pending',
      enteredAt: NOW,
    })
  })

  it('accepts an explicit status for an advance', () => {
    expect(
      submissionRoundFields({
        submissionId: 'recSub1',
        roundId: 'recRnd2',
        status: 'in_review',
        enteredAt: NOW,
      }).status,
    ).toBe('in_review')
  })
})

describe('statusFields', () => {
  it('stamps submittedAt on the first move into pending', () => {
    const fields = statusFields({ status: 'pending', submittedAt: NOW })
    expect(fields).toEqual({ status: 'pending', submittedAt: NOW })
  })

  it('never overwrites a submit time the row already has', () => {
    // `pending` is re-entered when an organizer pulls a row back out of a decision
    // queue. Restamping then would date a month-old submission today.
    const fields = statusFields({
      status: 'pending',
      submittedAt: NOW,
      currentSubmittedAt: '2026-07-01T08:00:00.000Z',
    })
    expect(fields).not.toHaveProperty('submittedAt')
    expect(fields.status).toBe('pending')
  })

  it('does not stamp a submit time on any other transition', () => {
    for (const status of ['accept_queue', 'accepted', 'withdrawn', 'declined'] as const) {
      expect(statusFields({ status, submittedAt: NOW })).not.toHaveProperty('submittedAt')
    }
  })

  it('writes notifiedAt only when Notify supplied one', () => {
    expect(statusFields({ status: 'accepted', notifiedAt: NOW }).notifiedAt).toBe(NOW)
    expect(statusFields({ status: 'accepted' })).toEqual({ status: 'accepted' })
  })
})

describe('submissionEditFields', () => {
  it('writes the title, the typed columns, and the whole blob in one field set', () => {
    const fields = submissionEditFields({
      title: 'Evaluating agents without a golden dataset',
      answers: { fld_desc: '<p>Rewritten.</p>' },
      format: 'workshop',
      trackId: 'recTrack2',
      tagIds: ['recTag1'],
    })

    expect(fields.title).toBe('Evaluating agents without a golden dataset')
    expect(fields.answersJson).toBe('{"fld_desc":"<p>Rewritten.</p>"}')
    expect(fields.format).toBe('workshop')
    expect(fields.track).toEqual(['recTrack2'])
    expect(fields.tagIds).toBeUndefined()
    expect(fields.tags).toEqual(['recTag1'])
  })

  it('leaves an unanswered typed column alone rather than clearing it', () => {
    // `splitAnswers` omits a field that was never answered, so an untouched optional
    // question must not overwrite a column with nothing.
    const fields = submissionEditFields({ title: 'Same title', answers: {} })
    expect(fields).not.toHaveProperty('format')
    expect(fields).not.toHaveProperty('level')
    expect(fields).not.toHaveProperty('track')
    // The blob is always replaced, which is what makes a cleared question clearable.
    expect(fields.answersJson).toBe('{}')
  })
})
