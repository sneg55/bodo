// Builders for the portal tests. Not a test file (vitest only collects
// `tests/**/*.test.ts`), just the shapes several of them need.
//
// Everything here is a full domain record built from overrides, rather than a cast of a
// partial object, so a field added to `Submission` or `Task` breaks these builders in one
// place instead of silently reading as undefined inside a dozen assertions.

import type { FileRequestItem } from '@/services/airtable/reads-requests'
import type {
  Speaker,
  StoredFile,
  Submission,
  SubmissionParticipant,
  SubmissionWithParticipants,
  Task,
  TaskAssignment,
} from '@/types/domain'
import type { FileRequest, FileRequestAssignment } from '@/types/file-requests'
import type { Form, FormField } from '@/types/forms'

export const OWNER = 'recSpeakerOwner'
export const CO_SPEAKER = 'recSpeakerCo'
export const STRANGER = 'recSpeakerStranger'

export function speaker(overrides: Partial<Speaker> = {}): Speaker {
  return {
    id: OWNER,
    email: 'owner@example.com',
    firstName: 'Ada',
    lastName: 'Okafor',
    links: {},
    ...overrides,
  }
}

export function participant(
  overrides: Partial<SubmissionParticipant> & { speaker?: Speaker } = {},
): SubmissionParticipant & { speaker: Speaker } {
  const speakerId = overrides.speakerId ?? OWNER
  return {
    id: `recPar-${speakerId}`,
    submissionId: 'recSub1',
    speakerId,
    role: 'speaker',
    isPrimary: true,
    sortOrder: 1,
    ...overrides,
    speaker: overrides.speaker ?? speaker({ id: speakerId, email: `${speakerId}@example.com` }),
  }
}

export function submission(
  overrides: Partial<Submission> = {},
  participants: readonly (SubmissionParticipant & { speaker: Speaker })[] = [participant()],
): SubmissionWithParticipants {
  return {
    id: 'recSub1',
    eventId: 'recEvent1',
    formId: 'recForm1',
    submitterId: OWNER,
    code: 'SESS-1',
    title: 'Evaluating agents without a golden dataset',
    status: 'pending',
    source: 'form',
    reviewRequired: true,
    answers: {},
    tagIds: [],
    scheduleStatus: 'unscheduled',
    contentStatus: 'not_submitted',
    calendarSequence: 0,
    calendarStatus: 'active',
    ...overrides,
    participants,
  }
}

export function field(overrides: Partial<FormField> & { id: string }): FormField {
  return { type: 'text', label: overrides.id, required: false, ...overrides }
}

export function form(overrides: Partial<Form> = {}): Form {
  return {
    id: 'recForm1',
    eventId: 'recEvent1',
    name: 'Call for Speakers',
    publicId: 'publicid1',
    kind: 'cfp',
    entityKind: 'abstracts',
    participantsEnabled: true,
    status: 'published',
    fields: [],
    participantFields: [],
    routing: { rules: [] },
    roles: [],
    crossFieldLimits: [],
    allowMultipleDrafts: false,
    autoRedirectToPortal: false,
    confirmationEmailEnabled: false,
    adminAlertOnNew: [],
    adminAlertOnUpdate: [],
    ...overrides,
  }
}

export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'recTask1',
    eventId: 'recEvent1',
    title: 'Upload your slides',
    entityType: 'submission',
    origin: 'manual',
    kind: 'upload',
    ...overrides,
  }
}

export function assignment(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    id: 'recAsg1',
    taskId: 'recTask1',
    speakerId: OWNER,
    status: 'pending',
    ...overrides,
  }
}

export function fileRequest(overrides: Partial<FileRequest> = {}): FileRequest {
  return {
    id: 'recReq1',
    eventId: 'recEvent1',
    title: 'Upload Presentation Slides',
    entityType: 'submission',
    required: true,
    ...overrides,
  }
}

export function requestAssignment(
  overrides: Partial<FileRequestAssignment> = {},
): FileRequestAssignment {
  return {
    id: 'recReqAsg1',
    fileRequestId: 'recReq1',
    speakerId: OWNER,
    status: 'pending',
    ...overrides,
  }
}

/** An assignment with its request resolved: the shape both file request surfaces read. */
export function requestItem(input: {
  request?: FileRequest
  assignment?: Partial<FileRequestAssignment>
}): FileRequestItem {
  const request = input.request ?? fileRequest()
  return {
    request,
    assignment: requestAssignment({ fileRequestId: request.id, ...input.assignment }),
  }
}

export function storedFile(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    id: 'recFile1',
    speakerId: OWNER,
    kind: 'slides',
    objectKey: 'slides/recSpeakerOwner/abc-deck.pdf',
    visibility: 'private',
    contentType: 'application/pdf',
    filename: 'deck.pdf',
    size: 2048,
    uploadedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}
