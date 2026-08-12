// JSON-RPC 2.0 and the three MCP methods bodo answers, as pure functions.
//
// **Hand-rolled rather than the MCP SDK, and that is a Workers decision.** The SDK ships Node
// transports (stdio, and an SSE server built on `node:http`), and this runtime has neither.
// What the Streamable HTTP transport actually requires of a server is a POST endpoint that
// takes a JSON-RPC request and returns a JSON-RPC response, which is small enough that
// wrapping a Node shim to get it would be more code than writing it.
//
// Pure, and separate from the route, because every rule here is about the SHAPE of a message
// rather than about Airtable: an id echoed back, a notification that must produce no response
// at all, an unknown method that must be an error object rather than a thrown exception. All
// of it is testable with no network and no base.

/** The version of the protocol this server speaks, echoed in the initialize result. */
export const PROTOCOL_VERSION = '2025-06-18'

export const JSONRPC_VERSION = '2.0'

/** Per the JSON-RPC 2.0 spec, section 5.1. */
export const ERROR_CODES = {
  parse: -32_700,
  invalidRequest: -32_600,
  methodNotFound: -32_601,
  invalidParams: -32_602,
  internal: -32_603,
} as const

export type JsonRpcId = string | number | null

export type JsonRpcRequest = {
  readonly jsonrpc: string
  readonly method: string
  readonly id?: JsonRpcId
  readonly params?: Record<string, unknown>
}

export type JsonRpcResponse = {
  readonly jsonrpc: typeof JSONRPC_VERSION
  readonly id: JsonRpcId
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string }
}

/**
 * Whether a parsed body is a request this server can route.
 *
 * Deliberately lenient about `id`, which is absent on a notification and present on a call,
 * and strict about `method`, which is the only field routing depends on.
 */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.jsonrpc === JSONRPC_VERSION && typeof candidate.method === 'string'
}

/**
 * A notification is a request with NO `id`, and the spec says a server must not reply to one.
 *
 * This matters in practice rather than in theory: MCP clients send `notifications/initialized`
 * immediately after the handshake, and a server that answers it with a response carrying a
 * null id puts a reply on the wire that the client never asked for. Some clients log it, some
 * treat the session as broken.
 */
export function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined
}

export function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, result }
}

export function jsonRpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } }
}

/** What `initialize` answers: who this server is and what it can do. */
export function initializeResult(): unknown {
  return {
    protocolVersion: PROTOCOL_VERSION,
    // Only `tools`. bodo exposes no resources, prompts, or sampling, and declaring a
    // capability a server does not implement is how a client comes to call something that
    // then fails.
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'bodo', version: '1' },
  }
}

/**
 * Tool output, in MCP's content envelope.
 *
 * MCP has no typed result: a tool returns content blocks, and every client renders `text`.
 * So structured data goes back as pretty-printed JSON in a text block, which is both what an
 * agent reads best and what a human debugging the connection can actually see.
 */
export function toolResult(value: unknown): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/**
 * A tool that failed, reported as a RESULT rather than as a JSON-RPC error.
 *
 * This is MCP's own distinction and it is worth keeping: a protocol error means the call
 * itself was malformed, while `isError` means the tool ran and could not do the job. An agent
 * can recover from the second by trying something else; the first tells it the server is
 * broken.
 */
export function toolError(message: string): unknown {
  return { content: [{ type: 'text', text: message }], isError: true }
}
