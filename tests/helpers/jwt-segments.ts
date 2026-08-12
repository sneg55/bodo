// Reading and rewriting a JWT's payload, which is how the token tests assert on the
// claim set and how they forge a tampered token.
//
// Hand-rolled base64url rather than Buffer, so these helpers behave the same way under
// `workerd` as they do under vitest, and so nothing here needs a Node global. Shared
// because two test files now inspect claims: the token round-trips and the impersonation
// claim.

export function decodeSegment(segment: string): Record<string, unknown> {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return JSON.parse(atob(padded)) as Record<string, unknown>
}

export function encodeSegment(claims: Record<string, unknown>): string {
  return btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The claims every session token carries, so a test can assert what was ADDED. */
export const BASE_SESSION_CLAIMS: readonly string[] = ['aud', 'exp', 'iat', 'iss', 'kind', 'sub']
