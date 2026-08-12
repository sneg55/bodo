// The four tables the portal and the sender read, mapped from Airtable's own shape.
//
// Written by hand in wire shape rather than round-tripped through the field builders,
// for the same reason tests/airtable-mapping.test.ts is: a round trip agrees with itself
// even when both halves are wrong. Every record below is a way a real base differs from
// the naive guess, plus the three defaults that were chosen because being wrong about
// them is unrecoverable (a private file served publicly, a blank email delivered, an
// upload task satisfied by a checkbox).

import { describe, expect, it } from 'vitest'

import { isAppError } from '@/constants/errorIds'
import {
  mapFile,
  mapOutboxRow,
  mapTask,
  mapTaskAssignment,
} from '@/services/airtable/mapping-portal'
import type { AirtableRecord } from '@/services/airtable/records'

function record(id: string, fields: Record<string, unknown>): AirtableRecord {
  return { id, fields }
}

function errorId(thrown: unknown): string {
  return isAppError(thrown) ? thrown.id : `not an AppError: ${String(thrown)}`
}

function caught(fn: () => unknown): unknown {
  try {
    fn()
    return undefined
  } catch (error) {
    return error
  }
}

const TASK_CORE = { event: ['recEvent1'], title: 'Upload your slides', kind: 'upload' }

describe('mapTask', () => {
  it('collapses links and reads the whole row', () => {
    const task = mapTask(
      record('recTask1', {
        ...TASK_CORE,
        description: 'PDF or Keynote.',
        entityType: 'submission',
        origin: 'automated',
        form: ['recForm1'],
        dueAt: '2026-10-05T23:59:00.000Z',
        appliesTo: 'all_accepted',
      }),
    )

    expect(task.eventId).toBe('recEvent1')
    expect(task.formId).toBe('recForm1')
    expect(task.entityType).toBe('submission')
    expect(task.origin).toBe('automated')
    expect(task.appliesTo).toBe('all_accepted')
  })

  it('defaults a blank entityType to contact and a blank origin to manual', () => {
    const task = mapTask(record('recTask2', TASK_CORE))
    // The harmless half of being wrong: the speaker still sees the task under My
    // Tasks, and no per-submission row is invented for a task that has none.
    expect(task.entityType).toBe('contact')
    expect(task.origin).toBe('manual')
    expect(task.appliesTo).toBeUndefined()
    expect(task.dueAt).toBeUndefined()
  })

  it('refuses a task with no kind rather than guessing confirm', () => {
    // `kind` decides what evidence completion collects. Read as `confirm`, a checkbox
    // would satisfy an upload the organizer is waiting on, and the task would show as
    // done with nothing attached.
    const thrown = caught(() => mapTask(record('recTask3', { event: ['recEvent1'], title: 'x' })))
    expect(errorId(thrown)).toBe('E_DATA_002')
  })

  it('refuses a kind outside the vocabulary', () => {
    const thrown = caught(() =>
      mapTask(record('recTask4', { ...TASK_CORE, kind: 'questionnaire' })),
    )
    expect(errorId(thrown)).toBe('E_DATA_002')
  })
})

describe('mapTaskAssignment', () => {
  it('reads the three links, the status, and the form answers', () => {
    const assignment = mapTaskAssignment(
      record('recTasg1', {
        task: ['recTask1'],
        speaker: ['recSpk1'],
        submission: ['recSub1'],
        status: 'done',
        completedAt: '2026-08-08T09:00:00.000Z',
        answersJson: '{"fld_av":"HDMI"}',
      }),
    )

    expect(assignment.taskId).toBe('recTask1')
    expect(assignment.speakerId).toBe('recSpk1')
    expect(assignment.submissionId).toBe('recSub1')
    expect(assignment.status).toBe('done')
    expect(assignment.answers).toEqual({ fld_av: 'HDMI' })
  })

  it('treats a contact task with no submission link as pending and unscoped', () => {
    const assignment = mapTaskAssignment(
      record('recTasg2', { task: ['recTask1'], speaker: ['recSpk1'] }),
    )
    expect(assignment.submissionId).toBeUndefined()
    expect(assignment.status).toBe('pending')
    expect(assignment.completedAt).toBeUndefined()
    expect(assignment.answers).toEqual({})
  })

  it('refuses an assignment whose task link is empty', () => {
    const thrown = caught(() => mapTaskAssignment(record('recTasg3', { speaker: ['recSpk1'] })))
    expect(errorId(thrown)).toBe('E_DATA_002')
  })
})

const FILE_CORE = { speaker: ['recSpk1'], objectKey: 'slides/recSpk1/deck.pdf' }

describe('mapFile', () => {
  it('reads the row and keeps the object key rather than a URL', () => {
    const file = mapFile(
      record('recFile1', {
        ...FILE_CORE,
        submission: ['recSub1'],
        fileRequestAssignment: ['recFra1'],
        kind: 'slides',
        visibility: 'private',
        contentType: 'application/pdf',
        filename: 'deck.pdf',
        size: 4096,
        uploadedAt: '2026-08-08T11:00:00.000Z',
        verifiedAt: '2026-08-08T11:00:02.000Z',
      }),
    )

    expect(file.objectKey).toBe('slides/recSpk1/deck.pdf')
    expect(file.submissionId).toBe('recSub1')
    expect(file.fileRequestAssignmentId).toBe('recFra1')
    expect(file.verifiedAt).toBe('2026-08-08T11:00:02.000Z')
    // There is no url property to read, by design (section 5.2). If one ever appears,
    // the bucket domain and the access model both stop being changeable.
    expect(Object.keys(file)).not.toContain('url')
  })

  it('defaults visibility to private when the column is blank', () => {
    // The one default here that could not be undone. Public would serve somebody's
    // unreleased slides to the internet because an organizer left a cell empty.
    expect(mapFile(record('recFile2', FILE_CORE)).visibility).toBe('private')
  })

  it('falls back to the key segment for a filename and to octet-stream for a type', () => {
    const file = mapFile(record('recFile3', FILE_CORE))
    expect(file.filename).toBe('deck.pdf')
    expect(file.contentType).toBe('application/octet-stream')
    expect(file.size).toBe(0)
    // Unverified is a fact the caller may need to act on, not something to paper over.
    expect(file.verifiedAt).toBeUndefined()
  })

  it('refuses a row with no object key, because it points at no bytes', () => {
    const thrown = caught(() => mapFile(record('recFile4', { speaker: ['recSpk1'] })))
    expect(errorId(thrown)).toBe('E_DATA_002')
  })
})

const OUTBOX_CORE = {
  event: ['recEvent1'],
  idempotencyKey: 'accepted:recSub1:2026-08-06T12:00:00.000Z',
  payloadJson: '{"subject":"You are in","html":"<p>Congratulations</p>"}',
  toEmail: 'ada@example.com',
  sendAt: '2026-08-06T12:05:00.000Z',
}

describe('mapOutboxRow', () => {
  it('reads a queued row, defaulting attempts and status', () => {
    const row = mapOutboxRow(record('recOut1', OUTBOX_CORE))

    expect(row.status).toBe('queued')
    expect(row.attempts).toBe(0)
    expect(row.templateSource).toBe('system')
    expect(row.payload.subject).toBe('You are in')
    // Absent in the blob, defaulted by the schema, so a row queued before the flag
    // existed does not read as "attach a calendar invite".
    expect(row.payload.attachIcs).toBe(false)
    expect(row.sentAt).toBeUndefined()
  })

  it('keeps the template link optional and records why', () => {
    // A confirmation email is authored inline on the form, so there is no
    // EmailTemplates row to link. Section 5.3.
    const row = mapOutboxRow(
      record('recOut2', { ...OUTBOX_CORE, templateSource: 'form_inline', form: ['recForm1'] }),
    )
    expect(row.templateId).toBeUndefined()
    expect(row.templateSource).toBe('form_inline')
    expect(row.formId).toBe('recForm1')
  })

  it('reads the lease columns without treating them as a lock', () => {
    const row = mapOutboxRow(
      record('recOut3', {
        ...OUTBOX_CORE,
        status: 'sending',
        attempts: 2,
        leaseHolder: 'worker-7',
        leaseExpiresAt: '2026-08-06T12:06:00.000Z',
      }),
    )
    expect(row.status).toBe('sending')
    expect(row.attempts).toBe(2)
    expect(row.leaseHolder).toBe('worker-7')
  })

  it('refuses a row with no payload rather than sending a blank email', () => {
    const thrown = caught(() =>
      mapOutboxRow(record('recOut4', { ...OUTBOX_CORE, payloadJson: '' })),
    )
    expect(errorId(thrown)).toBe('E_DATA_002')
  })

  it('refuses a payload that is not the shape the sender expects', () => {
    const thrown = caught(() =>
      mapOutboxRow(record('recOut5', { ...OUTBOX_CORE, payloadJson: '{"subject":"only this"}' })),
    )
    expect(errorId(thrown)).toBe('E_DATA_002')
  })

  it('refuses a row with no send time and no idempotency key', () => {
    expect(
      errorId(caught(() => mapOutboxRow(record('recOut6', { ...OUTBOX_CORE, sendAt: '' })))),
    ).toBe('E_DATA_002')
    expect(
      errorId(
        caught(() => mapOutboxRow(record('recOut7', { ...OUTBOX_CORE, idempotencyKey: '' }))),
      ),
    ).toBe('E_DATA_002')
  })
})
