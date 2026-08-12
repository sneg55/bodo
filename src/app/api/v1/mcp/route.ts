// `POST /api/v1/mcp`: bodo as an MCP server, over Streamable HTTP.
//
// One endpoint, the same bearer token as the REST routes, and no session state. The
// Streamable HTTP transport allows a server to keep sessions and stream over SSE; this one
// does neither, on purpose. Workers isolates come and go between requests (see the runtime
// rules in `.claude/rules/bodo-conventions.md`), so a session map held in module state would
// be correct on one isolate and empty on the next. Every tool here is a pure read, so there
// is nothing a session would buy.
//
// **A notification gets HTTP 202 and an empty body.** MCP clients send
// `notifications/initialized` right after the handshake, and JSON-RPC forbids replying to a
// message with no id. Answering it with a response carrying a null id is the single most
// common way a hand-rolled MCP server appears to connect and then behaves oddly.

import { isAppError } from '@/constants/errorIds'
import { authenticate } from '@/features/api/auth'
import {
  ERROR_CODES,
  initializeResult,
  isJsonRpcRequest,
  isNotification,
  type JsonRpcId,
  jsonRpcError,
  jsonRpcResult,
  toolError,
  toolResult,
} from '@/features/api/mcp-protocol'
import { isToolFacing, MCP_TOOLS, toolDescriptors } from '@/features/api/mcp-tools'
import { apiHandler, unauthorized } from '@/features/api/responses'

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store',
} as const

export async function POST(request: Request): Promise<Response> {
  // Same wrapper as the REST routes, for the same measured reason: an uncaught throw here is
  // rendered by Next as HTML, and an MCP client parsing that as JSON-RPC reports something
  // unrelated to what went wrong. `apiHandler` answers a JSON envelope instead. A tool that
  // fails is NOT this path: `callTool` turns an AppError into an `isError` tool result, which
  // an agent can act on. This only catches a failure in the handshake itself.
  return await apiHandler(async () => await route(request))
}

async function route(request: Request): Promise<Response> {
  const caller = await authenticate(request)
  if (caller === undefined) return unauthorized()

  const body: unknown = await request.json().catch(() => undefined)
  if (!isJsonRpcRequest(body)) {
    return json(jsonRpcError(null, ERROR_CODES.invalidRequest, 'expected a JSON-RPC 2.0 request'))
  }

  // Accepted and answered with nothing, per the header note.
  if (isNotification(body)) return new Response(null, { status: 202 })

  const id: JsonRpcId = body.id ?? null

  switch (body.method) {
    case 'initialize': {
      return json(jsonRpcResult(id, initializeResult()))
    }
    case 'tools/list': {
      return json(jsonRpcResult(id, toolDescriptors()))
    }
    case 'tools/call': {
      return json(jsonRpcResult(id, await callTool(body.params, caller)))
    }
    default: {
      return json(jsonRpcError(id, ERROR_CODES.methodNotFound, `unknown method ${body.method}`))
    }
  }
}

/**
 * Run one tool.
 *
 * A failure comes back as a tool RESULT with `isError`, not as a JSON-RPC error, which is
 * MCP's own distinction: "the tool could not do that" is something an agent recovers from by
 * trying something else, while a protocol error tells it the server is broken.
 *
 * An unexpected exception is re-thrown rather than flattened into a message, exactly as
 * `actionFailure` does on the action side: a bug in a mapper belongs in the logs and the error
 * boundary, not reported to an agent as though its arguments were at fault.
 *
 * **Only a message the tool wrote itself is passed through**, which is the same suppression
 * `apiHandler` performs for the REST routes and for the same reason: an `AppError` off the
 * Airtable client carries the table name, the HTTP status, and up to 300 characters of
 * Airtable's own response body (`src/services/airtable/failure.ts`), none of which belongs in
 * a public answer. Returning the bare id keeps the one part that is worth quoting in a bug
 * report, which is the trade responses.ts already made. The distinction MCP cares about
 * survives: "no event with slug x" and "event is required" still say so, because an agent
 * recovers from those by trying something else, and they are marked at their throw site.
 */
async function callTool(
  params: Record<string, unknown> | undefined,
  caller: Awaited<ReturnType<typeof authenticate>> & object,
): Promise<unknown> {
  const name = params?.name
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name)
  if (tool === undefined) return toolError(`unknown tool ${String(name)}`)

  const args = params?.arguments
  try {
    return toolResult(
      await tool.run(
        typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
        caller,
      ),
    )
  } catch (error) {
    if (!isAppError(error)) throw error
    return toolError(
      isToolFacing(error) ? error.message : `the request could not be completed (${error.id})`,
    )
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: HEADERS })
}
