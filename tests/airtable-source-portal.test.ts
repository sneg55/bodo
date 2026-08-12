// The fixture half of the new reads, which is what a clone with an empty `.env` demos.
//
// This runs with no AIRTABLE_TOKEN in the environment, so `getSource()` hands back the
// fixture branch, which is exactly the case worth asserting: the fixtures are a real
// implementation of `DataSource` and not a stub, so a fixture that scopes or orders
// differently from the live path is a demo that proves the wrong thing.

import { describe, expect, it } from 'vitest'

import { getSource } from '@/services/airtable/source'
import { hasAirtable } from '@/utils/env'

const EVENT = 'fixEvent1'

describe('the fixture source, portal reads', () => {
  it('is the branch under test', () => {
    // Guards the rest of the file: with credentials present these would try to reach
    // Airtable and the failures would look like fixture bugs.
    expect(hasAirtable()).toBe(false)
  })

  it('scopes a task list to one speaker and resolves the task', async () => {
    const items = await getSource().listTaskAssignmentsForSpeaker(EVENT, 'fixSpk1')

    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => item.assignment.speakerId === 'fixSpk1')).toBe(true)
    expect(items.every((item) => item.task.eventId === EVENT)).toBe(true)
    // Both headings the portal splits on have content, so neither renders its empty
    // state on a fresh clone (refs 17-18).
    expect(items.some((item) => item.task.entityType === 'submission')).toBe(true)
    expect(items.some((item) => item.task.entityType === 'contact')).toBe(true)
  })

  it('covers every task kind, so each portal control has something to render', async () => {
    const items = await getSource().listTaskAssignmentsForEvent(EVENT)
    const kinds = new Set(items.map((item) => item.task.kind))
    expect([...kinds].sort()).toEqual(['confirm', 'form', 'link', 'upload'])
  })

  it('ships one completed assignment, so progress is not always zero', async () => {
    const items = await getSource().listTaskAssignmentsForSpeaker(EVENT, 'fixSpk1')
    const done = items.filter((item) => item.assignment.status === 'done')
    expect(done).toHaveLength(1)
    expect(done[0]?.assignment.completedAt).toBeDefined()
  })

  it('answers nothing for an event with no tasks rather than throwing', async () => {
    expect(await getSource().listTaskAssignmentsForSpeaker('fixEventOther', 'fixSpk1')).toEqual([])
    expect(await getSource().listTaskAssignmentsForSpeaker(EVENT, 'fixSpkNobody')).toEqual([])
  })

  it('lists files by owner and by submission separately', async () => {
    const speakerFiles = await getSource().listFilesForSpeaker('fixSpk1')
    const submissionFiles = await getSource().listFilesForSubmission('fixSub1')

    // The headshot belongs to the speaker and to no submission, so it is in one list
    // and not the other. That split is the reason there are two reads.
    expect(speakerFiles.some((file) => file.kind === 'headshot')).toBe(true)
    expect(submissionFiles.every((file) => file.submissionId === 'fixSub1')).toBe(true)
    expect(submissionFiles.some((file) => file.kind === 'headshot')).toBe(false)
  })

  it('keeps everything but a headshot private, and stores keys not URLs', async () => {
    const files = await getSource().listFilesForSpeaker('fixSpk1')
    for (const file of files) {
      expect(file.objectKey).not.toContain('http')
      expect(file.visibility).toBe(file.kind === 'headshot' ? 'public' : 'private')
    }
  })

  it('includes an unverified upload, because a failed upload leaves one behind', async () => {
    const files = await getSource().listFilesForSubmission('fixSub2')
    expect(files.some((file) => file.verifiedAt === undefined)).toBe(true)
  })
})
