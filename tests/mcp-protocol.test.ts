// The MCP wire contract.
//
// Worth pinning because an MCP client is not a browser: it will not show you a stack trace,
// it will simply behave oddly. The two failures this catches are exactly the ones that look
// like a working connection: replying to a notification, and advertising a capability the
// server does not implement.

import { describe, expect, it } from 'vitest'

import {
  ERROR_CODES,
  initializeResult,
  isJsonRpcRequest,
  isNotification,
  JSONRPC_VERSION,
  jsonRpcError,
  jsonRpcResult,
  PROTOCOL_VERSION,
  toolError,
  toolResult,
} from '@/features/api/mcp-protocol'
import { MCP_TOOLS, toolDescriptors } from '@/features/api/mcp-tools'

describe('isJsonRpcRequest', () => {
  it('accepts a call and a notification', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'initialize', id: 1 })).toBe(true)
    expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(true)
  })

  it('refuses anything that is not a 2.0 request', () => {
    for (const body of [
      null,
      undefined,
      'initialize',
      42,
      [],
      {},
      { method: 'initialize' }, // no jsonrpc
      { jsonrpc: '1.0', method: 'initialize' },
      { jsonrpc: '2.0' }, // no method
      { jsonrpc: '2.0', method: 7 },
    ]) {
      expect(isJsonRpcRequest(body)).toBe(false)
    }
  })
})

describe('isNotification', () => {
  it('is true only when there is no id at all', () => {
    // The distinction that matters: JSON-RPC forbids replying to a notification, and `id: null`
    // is a real id for these purposes. Treating null as "no id" is how a server ends up
    // answering `notifications/initialized` with an unsolicited response.
    expect(isNotification({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(true)
    expect(isNotification({ jsonrpc: '2.0', method: 'initialize', id: null })).toBe(false)
    expect(isNotification({ jsonrpc: '2.0', method: 'initialize', id: 0 })).toBe(false)
    expect(isNotification({ jsonrpc: '2.0', method: 'initialize', id: '' })).toBe(false)
  })
})

describe('envelopes', () => {
  it('echo the id, including the falsy ones a client may legitimately use', () => {
    expect(jsonRpcResult(0, {}).id).toBe(0)
    expect(jsonRpcError('', ERROR_CODES.internal, 'x').id).toBe('')
  })

  it('carry the protocol version and never both result and error', () => {
    const ok = jsonRpcResult(1, { a: 1 })
    const bad = jsonRpcError(1, ERROR_CODES.methodNotFound, 'nope')

    expect(ok.jsonrpc).toBe(JSONRPC_VERSION)
    expect(ok.error).toBeUndefined()
    expect(bad.result).toBeUndefined()
    expect(bad.error?.code).toBe(-32_601)
  })
})

describe('initializeResult', () => {
  it('advertises tools and nothing bodo does not implement', () => {
    const result = initializeResult() as {
      protocolVersion: string
      capabilities: Record<string, unknown>
    }

    expect(result.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(Object.keys(result.capabilities)).toEqual(['tools'])
    // Declaring `resources` or `prompts` here is how a client comes to call something that
    // then fails, so the absence is the assertion.
    expect(result.capabilities.resources).toBeUndefined()
    expect(result.capabilities.prompts).toBeUndefined()
  })
})

describe('tool results', () => {
  it('put structured data in a text block, which is what every client renders', () => {
    const result = toolResult({ sessions: 2 }) as { content: { type: string; text: string }[] }

    expect(result.content.at(0)?.type).toBe('text')
    expect(JSON.parse(result.content.at(0)?.text ?? '')).toEqual({ sessions: 2 })
  })

  it('mark a tool failure with isError rather than raising a protocol error', () => {
    const result = toolError('no event with slug x') as { isError: boolean }

    expect(result.isError).toBe(true)
  })
})

describe('the tool catalogue', () => {
  it('lists every tool with a name, a description and a schema', () => {
    const { tools } = toolDescriptors() as {
      tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]
    }

    expect(tools).toHaveLength(MCP_TOOLS.length)
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/)
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('does not leak the implementations into the wire payload', () => {
    const { tools } = toolDescriptors() as { tools: Record<string, unknown>[] }

    for (const tool of tools) {
      expect(tool.run).toBeUndefined()
    }
  })

  it('names each tool exactly once', () => {
    const names = MCP_TOOLS.map((tool) => tool.name)

    expect(new Set(names).size).toBe(names.length)
  })
})
