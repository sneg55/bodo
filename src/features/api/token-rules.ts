// Minting and presenting a bearer token, as pure rules.
//
// Separate from `tokens.ts` next door, which does the Airtable read, for the reason the auth
// feature splits `guards.ts` from `wiring.ts`: everything worth getting right here is about
// strings and prefixes, and all of it is testable with no base and no network.
//
// **The digest is the whole design.** `mintToken` is the only place a plaintext value exists,
// `hashToken` is what the base stores, and nothing anywhere converts a digest back. So the
// worst a leaked Airtable view yields is a list of hashes, and "bodo cannot show you that
// token again" is a property of the schema rather than a promise in the UI.

/**
 * Every bodo token starts here, which is not decoration.
 *
 * A recognisable prefix is what lets a secret scanner match one in a committed `.env` or a
 * pasted snippet, and it is why GitHub, Stripe and Slack all do it. It also means a caller
 * who has pasted the wrong string gets told so by shape rather than by a 401.
 */
export const TOKEN_PREFIX = 'bodo_'

/** Bytes of entropy behind the prefix. 32 is the floor for a credential with no expiry. */
const TOKEN_BYTES = 32

/**
 * A fresh bearer value. Returned to the organizer exactly once and never stored.
 *
 * `crypto.getRandomValues` and not `Math.random`, which is not a CSPRNG, and not
 * `randomUUID`, which is 122 bits with 6 of them fixed by the version and variant fields.
 */
export function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
  return `${TOKEN_PREFIX}${base64Url(bytes)}`
}

/**
 * The SHA-256 hex of a presented value, which is what the base holds.
 *
 * Plain SHA-256 rather than a password hash, deliberately. A bcrypt or Argon2 cost exists to
 * slow an offline guess at a LOW-ENTROPY secret that a human chose; this value is 32 random
 * bytes, so there is nothing to guess, and a per-request KDF would only add latency to every
 * API call. The same reasoning GitHub publishes for its own tokens.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The bearer value out of an `Authorization` header, or `undefined`.
 *
 * The scheme match is case-insensitive because RFC 7235 says it is, and a client sending
 * `bearer` lowercase is common enough that refusing it would read as a bodo bug.
 */
export function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined
  // A positional group rather than a named one: `tsconfig` targets below ES2018, where a
  // named capture is a compile error rather than a style choice.
  const token = /^Bearer[ ]+(\S+)$/i.exec(header.trim())?.at(1)
  return token === undefined || token === '' ? undefined : token
}

/**
 * What the settings table shows in place of the value it cannot show.
 *
 * The last four characters only, and the prefix. Enough for an organizer holding two tokens
 * in two places to tell which row is which, and far too little to reconstruct.
 */
export function maskToken(token: string): string {
  return `${TOKEN_PREFIX}${'…'}${token.slice(-4)}`
}

/** URL-safe base64 with the padding dropped, so the value survives a query string intact. */
function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}
