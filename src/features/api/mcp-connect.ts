// The connection details an organizer copies into an MCP client, as data.
//
// **Pure, and free of every server dependency, because the setup panel is a client
// component.** `MCP_TOOLS` cannot be imported into that panel: its `run` functions reach
// `services/airtable/queries`, so importing it for the four tool NAMES would pull the DAL
// into the browser bundle. The page reads the descriptors server side and hands the panel
// plain strings; this module holds everything else the panel needs.
//
// The endpoint, the transport and the protocol version are derived rather than typed out,
// for the reason `/docs/api` builds its examples from `appUrl()`: a self-hosted deployment
// must document its own origin, and a bumped `PROTOCOL_VERSION` must not leave a stale
// number on a settings page nobody thinks to update.

import { PROTOCOL_VERSION } from '@/features/api/mcp-protocol'

/**
 * What stands in for the bearer value when there is nothing to show.
 *
 * A token is readable exactly once, at mint (`createApiTokenAction`), so an organizer who
 * comes back to this page tomorrow, or who picks one of their existing tokens out of the
 * list, cannot be shown the string. The config block still has to be copyable, so it carries
 * this and says so, rather than rendering an empty header that looks broken.
 */
export const MCP_TOKEN_PLACEHOLDER = '<your token>'

/** The path the MCP route is mounted at (`src/app/api/v1/mcp/route.ts`). */
export const MCP_PATH = '/api/v1/mcp'

export function mcpEndpoint(origin: string): string {
  // `appUrl()` is normalised without a trailing slash, but a self-hosted `APP_URL` set by
  // hand is the one input here nobody validates, and `https://x//api/v1/mcp` is a 404 that
  // reads as "your server is broken" rather than as "your config has a slash in it".
  return `${origin.replace(/\/+$/, '')}${MCP_PATH}`
}

export type McpConnectionField = {
  readonly id: string
  readonly label: string
  readonly value: string
  /** What the copy button puts on the clipboard, when that is not the displayed value. */
  readonly copyValue: string
  readonly hint?: string
}

/**
 * The four things every MCP client asks for, whatever shape its own config file takes.
 *
 * Client-agnostic on purpose: a `claude mcp add` line, a `.cursor/mcp.json` block and a
 * Desktop connector form are three renderings of these same four values, and each one of
 * them is a string that goes stale when its vendor changes a flag. The one-liner for Claude
 * Code still exists, on `/docs/api`, which this page links to.
 */
export function mcpConnectionFields({
  origin,
  token,
}: {
  origin: string
  token?: string
}): readonly McpConnectionField[] {
  const bearer = `Bearer ${token ?? MCP_TOKEN_PLACEHOLDER}`

  return [
    {
      id: 'endpoint',
      label: 'Endpoint',
      value: mcpEndpoint(origin),
      copyValue: mcpEndpoint(origin),
    },
    {
      id: 'transport',
      label: 'Transport',
      value: 'HTTP (JSON-RPC 2.0)',
      copyValue: 'http',
      hint: 'Streamable HTTP. There is no stdio command to run: bodo is a remote server.',
    },
    {
      id: 'authorization',
      label: 'Authorization header',
      value: bearer,
      // The HEADER, name included, because that is what a config file's `headers` map wants
      // and reassembling `Authorization: ` by hand is where a colon goes missing.
      copyValue: `Authorization: ${bearer}`,
      hint:
        token === undefined
          ? 'Replace the placeholder with a token value. bodo cannot show you an existing one.'
          : undefined,
    },
    {
      id: 'protocol',
      label: 'Protocol version',
      value: PROTOCOL_VERSION,
      copyValue: PROTOCOL_VERSION,
    },
  ]
}

export type McpConnectionState =
  | { readonly status: 'waiting' }
  | { readonly status: 'connected'; readonly at: string }
  | { readonly status: 'revoked' }

/**
 * What the connection check concluded from the token row.
 *
 * `lastUsedAt` is load-bearing here and it is trustworthy: `authenticate()` AWAITS the stamp
 * rather than firing it off (`src/features/api/auth.ts`), precisely so the column is not
 * "sometimes true" on a runtime that tears the isolate down at response time. So a value in
 * it means some client presented this credential and was let in, which is the only evidence
 * this page can offer that a config was pasted correctly.
 *
 * **Revoked is a distinct answer rather than a failed check.** An organizer who selects a
 * revoked token out of their list would otherwise sit in front of a spinner that is never
 * going to turn green, since the request that would stamp it is refused before the stamp.
 */
export function connectionState(token: {
  readonly lastUsedAt?: string
  readonly revokedAt?: string
}): McpConnectionState {
  if (token.revokedAt !== undefined) return { status: 'revoked' }
  if (token.lastUsedAt === undefined) return { status: 'waiting' }
  return { status: 'connected', at: token.lastUsedAt }
}
