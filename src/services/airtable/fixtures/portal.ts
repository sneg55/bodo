// Fixture tasks, task assignments, and files: what the portal renders with no base.
//
// Split from event.ts and submissions.ts for the line limit; see event.ts for what
// these are for and why the ids read `fix...` rather than `rec...`.
//
// Deliberately not degenerate, for the same reason the submission fixtures ship a
// double-booking. The set below covers every task `kind` (upload, form, link, confirm),
// both `entityType` halves the portal splits its two headings on (a contact task under
// `My Tasks`, a submission task under `Submission Tasks`), one already-done row so the
// progress control has something to show, and one assignment against a submission that
// also has a file, so the detail page's file list is not empty on a fresh clone.

import type { StoredFile, Task, TaskAssignment } from '@/types/domain'

export const FIXTURE_TASKS: readonly Task[] = [
  {
    id: 'fixTask1',
    eventId: 'fixEvent1',
    title: 'Upload your headshot',
    description: 'A square image, at least 800x800.',
    entityType: 'contact',
    origin: 'automated',
    kind: 'upload',
    dueAt: '2026-09-20T23:59:00.000Z',
    appliesTo: 'all_accepted',
  },
  {
    id: 'fixTask2',
    eventId: 'fixEvent1',
    title: 'Confirm your travel dates',
    entityType: 'contact',
    origin: 'manual',
    kind: 'confirm',
    dueAt: '2026-09-25T23:59:00.000Z',
  },
  {
    id: 'fixTask3',
    eventId: 'fixEvent1',
    title: 'Upload your slides',
    description: 'PDF or Keynote, 25 MB maximum.',
    entityType: 'submission',
    origin: 'automated',
    kind: 'upload',
    dueAt: '2026-10-05T23:59:00.000Z',
    appliesTo: 'all_accepted',
  },
  {
    id: 'fixTask4',
    eventId: 'fixEvent1',
    title: 'Session A/V questionnaire',
    entityType: 'submission',
    origin: 'manual',
    kind: 'form',
    formId: 'fixForm1',
  },
  {
    // No due date, so the ordering rule in reads-portal.ts has an undated row to sort
    // last rather than first.
    id: 'fixTask5',
    eventId: 'fixEvent1',
    title: 'Read the speaker handbook',
    entityType: 'contact',
    origin: 'manual',
    kind: 'link',
  },
]

export const FIXTURE_TASK_ASSIGNMENTS: readonly TaskAssignment[] = [
  {
    id: 'fixTasg1',
    taskId: 'fixTask1',
    speakerId: 'fixSpk1',
    status: 'done',
    completedAt: '2026-08-07T09:30:00.000Z',
    answers: {},
  },
  { id: 'fixTasg2', taskId: 'fixTask2', speakerId: 'fixSpk1', status: 'pending', answers: {} },
  {
    id: 'fixTasg3',
    taskId: 'fixTask3',
    speakerId: 'fixSpk1',
    submissionId: 'fixSub1',
    status: 'pending',
    answers: {},
  },
  {
    id: 'fixTasg4',
    taskId: 'fixTask4',
    speakerId: 'fixSpk1',
    submissionId: 'fixSub1',
    status: 'pending',
    answers: {},
  },
  { id: 'fixTasg5', taskId: 'fixTask5', speakerId: 'fixSpk1', status: 'pending', answers: {} },
  {
    id: 'fixTasg6',
    taskId: 'fixTask3',
    speakerId: 'fixSpk2',
    submissionId: 'fixSub2',
    status: 'pending',
    answers: {},
  },
]

export const FIXTURE_FILES: readonly StoredFile[] = [
  {
    id: 'fixFile1',
    speakerId: 'fixSpk1',
    kind: 'headshot',
    objectKey: 'headshot/fixSpk1/ada-okafor.jpg',
    // Public, because a headshot is served from R2_PUBLIC_BASE_URL. Everything else
    // here is private and goes through the authenticated route. Section 5.2.
    visibility: 'public',
    contentType: 'image/jpeg',
    filename: 'ada-okafor.jpg',
    size: 184_320,
    uploadedAt: '2026-08-07T09:30:00.000Z',
    verifiedAt: '2026-08-07T09:30:01.000Z',
  },
  {
    id: 'fixFile2',
    speakerId: 'fixSpk1',
    submissionId: 'fixSub1',
    kind: 'slides',
    objectKey: 'slides/fixSpk1/evaluating-agents.pdf',
    visibility: 'private',
    contentType: 'application/pdf',
    filename: 'evaluating-agents.pdf',
    size: 4_210_688,
    uploadedAt: '2026-08-08T11:00:00.000Z',
    verifiedAt: '2026-08-08T11:00:02.000Z',
  },
  {
    // No verifiedAt: an upload the server never confirmed. The portal has to be able to
    // render that state, because it is the one a failed upload leaves behind.
    id: 'fixFile3',
    speakerId: 'fixSpk2',
    submissionId: 'fixSub2',
    kind: 'doc',
    objectKey: 'doc/fixSpk2/rider.pdf',
    visibility: 'private',
    contentType: 'application/pdf',
    filename: 'rider.pdf',
    size: 51_200,
    uploadedAt: '2026-08-08T12:00:00.000Z',
  },
]
