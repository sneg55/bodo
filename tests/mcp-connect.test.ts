// What the MCP setup page tells an organizer to paste.
//
// Pinned because every failure here is silent in exactly the way the connection is: a client
// handed a doubled slash, a header missing its field name, or a stale protocol version does
// not report a bad config, it reports that the server did not answer.

import { describe, expect, it } from 'vitest'

import {
  connectionState,
  MCP_TOKEN_PLACEHOLDER,
  mcpConnectionFields,
  mcpEndpoint,
} from '@/features/api/mcp-connect'
import { PROTOCOL_VERSION } from '@/features/api/mcp-protocol'

const field = (origin: string, token: string | undefined, id: string) =>
  mcpConnectionFields({ origin, token }).find((entry) => entry.id === id)

describe('mcpEndpoint', () => {
  it('is the route the MCP handler is actually mounted at', () => {
    expect(mcpEndpoint('https://bodo.example')).toBe('https://bodo.example/api/v1/mcp')
  })

  it('does not double the slash on an origin that carries one', () => {
    // A hand-set APP_URL is the one input to this page that nothing validates.
    expect(mcpEndpoint('https://bodo.example/')).toBe('https://bodo.example/api/v1/mcp')
    expect(mcpEndpoint('https://bodo.example///')).toBe('https://bodo.example/api/v1/mcp')
  })
})

describe('mcpConnectionFields', () => {
  it('carries the token in the header when there is one to show', () => {
    const header = field('https://bodo.example', 'bodo_abc123', 'authorization')
    expect(header?.value).toBe('Bearer bodo_abc123')
    // The copied form keeps the field NAME: a `headers` map wants both halves.
    expect(header?.copyValue).toBe('Authorization: Bearer bodo_abc123')
    expect(header?.hint).toBeUndefined()
  })

  it('falls back to a placeholder, and says so, when the value cannot be shown', () => {
    const header = field('https://bodo.example', undefined, 'authorization')
    expect(header?.value).toBe(`Bearer ${MCP_TOKEN_PLACEHOLDER}`)
    expect(header?.hint).toContain('Replace the placeholder')
  })

  it('reports the protocol version the server answers with, not a copy of it', () => {
    expect(field('https://bodo.example', undefined, 'protocol')?.value).toBe(PROTOCOL_VERSION)
  })

  it('names no stdio command, because bodo is a remote server', () => {
    const transport = field('https://bodo.example', undefined, 'transport')
    expect(transport?.value).toBe('HTTP (JSON-RPC 2.0)')
    expect(transport?.hint).toContain('remote server')
  })

  it('leaks nothing but the token it was handed', () => {
    const fields = mcpConnectionFields({ origin: 'https://bodo.example', token: undefined })
    expect(fields.map((entry) => entry.id)).toEqual([
      'endpoint',
      'transport',
      'authorization',
      'protocol',
    ])
  })
})

describe('connectionState', () => {
  it('waits while the token has never authenticated', () => {
    expect(connectionState({})).toEqual({ status: 'waiting' })
  })

  it('confirms the connection off the stamp `authenticate` awaits', () => {
    expect(connectionState({ lastUsedAt: '2026-08-11T09:00:00.000Z' })).toEqual({
      status: 'connected',
      at: '2026-08-11T09:00:00.000Z',
    })
  })

  it('calls a revoked token revoked rather than leaving it waiting forever', () => {
    // The request that would stamp `lastUsedAt` is refused before the stamp, so "waiting"
    // here would be a spinner with no end.
    expect(connectionState({ revokedAt: '2026-08-11T10:00:00.000Z' })).toEqual({
      status: 'revoked',
    })
    expect(
      connectionState({
        lastUsedAt: '2026-08-11T09:00:00.000Z',
        revokedAt: '2026-08-11T10:00:00.000Z',
      }),
    ).toEqual({ status: 'revoked' })
  })
})
