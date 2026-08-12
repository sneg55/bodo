// Minting, hashing and presenting a bearer token.
//
// The header parse is where a public API meets clients it did not write, so the cases that
// matter are the malformed ones: every single one of them has to be `undefined` rather than
// a string that goes on to be hashed and looked up.

import { describe, expect, it } from 'vitest'

import {
  bearerToken,
  hashToken,
  maskToken,
  mintToken,
  TOKEN_PREFIX,
} from '@/features/api/token-rules'

describe('mintToken', () => {
  it('carries the scannable prefix', () => {
    expect(mintToken().startsWith(TOKEN_PREFIX)).toBe(true)
  })

  it('is URL-safe and unpadded, so it survives a query string intact', () => {
    const body = mintToken().slice(TOKEN_PREFIX.length)

    expect(body).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(body).not.toContain('=')
  })

  it('does not repeat', () => {
    const minted = new Set(Array.from({ length: 200 }, () => mintToken()))

    expect(minted.size).toBe(200)
  })
})

describe('hashToken', () => {
  it('is SHA-256 hex', async () => {
    expect(await hashToken('bodo_example')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is stable, which is what makes a lookup by digest work at all', async () => {
    expect(await hashToken('bodo_example')).toBe(await hashToken('bodo_example'))
  })

  it('separates values that differ by one character', async () => {
    expect(await hashToken('bodo_a')).not.toBe(await hashToken('bodo_b'))
  })

  it('never returns the input', async () => {
    // The property the whole design rests on: what reaches Airtable must not authenticate.
    const token = mintToken()

    expect(await hashToken(token)).not.toContain(token)
  })
})

describe('bearerToken', () => {
  it('reads a well-formed header', () => {
    expect(bearerToken('Bearer bodo_abc')).toBe('bodo_abc')
  })

  it('accepts the scheme in any case, per RFC 7235', () => {
    expect(bearerToken('bearer bodo_abc')).toBe('bodo_abc')
    expect(bearerToken('BEARER bodo_abc')).toBe('bodo_abc')
  })

  it('tolerates surrounding and repeated whitespace', () => {
    expect(bearerToken('  Bearer   bodo_abc  ')).toBe('bodo_abc')
  })

  it('refuses everything malformed', () => {
    for (const header of [
      null,
      '',
      '   ',
      'bodo_abc', // no scheme
      'Bearer', // no value
      'Bearer ', // empty value
      'Basic bodo_abc', // wrong scheme
      'Bearer bodo_abc extra', // two values
    ]) {
      expect(bearerToken(header)).toBeUndefined()
    }
  })
})

describe('maskToken', () => {
  it('shows the prefix and the last four and nothing between', () => {
    const masked = maskToken('bodo_ABCDEFGHIJKLMNOP')

    expect(masked.startsWith(TOKEN_PREFIX)).toBe(true)
    expect(masked.endsWith('MNOP')).toBe(true)
    expect(masked).not.toContain('ABCDEFGHIJKL')
  })
})
