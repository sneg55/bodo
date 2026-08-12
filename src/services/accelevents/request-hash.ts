// One semantic payload produces one request hash, independent of object key order.
// SyncLog stores JSON text written at different boundaries, so hashing the raw text
// would make whitespace changes look like a different Accelevents request.

import { AppError, ErrorIds } from '@/constants/errorIds'

export async function hashAcceleventsPayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(payload))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const fields = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    )
    return `{${fields
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`
  }
  throw new AppError(ErrorIds.ACCEL_BAD_REQUEST, 'Accelevents payload cannot be hashed', {
    valueType: typeof value,
  })
}
