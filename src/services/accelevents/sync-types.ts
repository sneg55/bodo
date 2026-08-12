// App-shaped records used by the Accelevents sync job.
//
// SyncLog payloads are snapshots. The retry sweep must replay the snapshot rather
// than rebuilding current entity state, or an old failure could silently send a
// different request from the one an organizer asked to retry.

import { z } from 'zod'

import type { SessionPayload, SpeakerPayload, TaxonomyPayload } from '@/services/accelevents/client'

export const SYNC_ENTITY_TYPES = ['speaker', 'submission', 'track', 'tag'] as const
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number]

export const INTEGRATION_ENTITY_TYPES = [...SYNC_ENTITY_TYPES, 'room', 'ticket_type'] as const
export type IntegrationEntityType = (typeof INTEGRATION_ENTITY_TYPES)[number]

export const SYNC_ACTIONS = ['create', 'update', 'skip'] as const
export type SyncAction = (typeof SYNC_ACTIONS)[number]

export const SYNC_STATUSES = ['ok', 'failed'] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

const optionalText = z.string().optional()
const optionalTextList = z.array(z.string()).optional()

export const speakerPayloadSchema = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    biography: optionalText,
    company: optionalText,
    headshotUrl: optionalText,
  })
  .strict()

export const sessionPayloadSchema = z
  .object({
    title: z.string(),
    description: optionalText,
    startTime: z.string(),
    endTime: z.string(),
    format: optionalText,
    room: optionalText,
    trackIds: optionalTextList,
    tagIds: optionalTextList,
    speakerIds: optionalTextList,
    ticketTypesThatCanBeRegistered: optionalTextList,
  })
  .strict()

export const trackPayloadSchema = z.object({ type: z.literal('TRACKS'), name: z.string() }).strict()

export const tagPayloadSchema = z.object({ type: z.literal('TAGS'), name: z.string() }).strict()

type SyncLogBase = {
  id: string
  eventId: string
  localId: string
  remoteId?: string
  action: SyncAction
  status: SyncStatus
  payloadJson: string
  error?: string
  at: string
}

export type SyncLogRow =
  | (SyncLogBase & { entityType: 'speaker'; payload: SpeakerPayload })
  | (SyncLogBase & { entityType: 'submission'; payload: SessionPayload })
  | (SyncLogBase & { entityType: 'track' | 'tag'; payload: TaxonomyPayload })

export type FailedSyncRow = SyncLogRow & {
  status: 'failed'
  requestHash: string
}

export type IntegrationMapping = {
  id: string
  eventId: string
  entityType: IntegrationEntityType
  localId: string
  remoteId: string
  requestHash: string
  syncedAt: string
}

export type MappingWrite = {
  mappingId?: string
  eventId: string
  entityType: SyncEntityType
  localId: string
  remoteId: string
  requestHash: string
  syncedAt: string
}

export type SyncLogWrite = {
  eventId: string
  entityType: SyncEntityType
  localId: string
  remoteId?: string
  action: SyncAction
  status: SyncStatus
  payload: SpeakerPayload | SessionPayload | TaxonomyPayload
  error?: string
  at: string
}
