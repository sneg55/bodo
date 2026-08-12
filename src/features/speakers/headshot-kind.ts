// The one word that selects the organizer's headshot branch, on its own.
//
// Same arrangement as `features/settings/event-images.ts` and for the same reason: the route,
// the server module that authorizes the upload, and the browser helper that posts the file
// all have to agree on this literal, and the browser must not import the other two. Nothing
// here touches the DAL, the storage service or the auth guards at runtime, so importing it
// from a client component pulls in one string rather than the server.
//
// `UploadKind` comes in as a TYPE only, which is what keeps this literal from drifting from
// the kinds the R2 layer knows about: rename it there and this stops compiling.

import type { UploadKind } from '@/services/storage/upload-limits'

export const SPEAKER_HEADSHOT_KIND = 'speaker-headshot' as const satisfies UploadKind
