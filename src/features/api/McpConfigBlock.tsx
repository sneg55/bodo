'use client'

// Step 2 of MCP setup: the four values, and the tools they unlock.
//
// CLIENT-AGNOSTIC ON PURPOSE, and that is the whole argument of this block. A `claude mcp add`
// line, a `.cursor/mcp.json` object and a Desktop connector form are three renderings of the
// same four fields, each one a string that goes stale the next time its vendor renames a flag,
// on a page nobody would think to update. These four cannot: the endpoint is built from this
// deployment's own origin, the protocol version is read from the server's handshake, and the
// tool list is passed in from `MCP_TOOLS` itself. The Claude Code one-liner still exists, on
// `/docs/api`, which the panel links to.
//
// The tool descriptions are the ones the server sends to the agent, verbatim, and showing them
// here is not decoration: they are what decides whether an agent calls the right tool, so an
// organizer wondering why their question went unanswered can read exactly what their client was
// told.

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { McpCopyButton } from '@/features/api/McpCopyButton'
import { McpStepNumber } from '@/features/api/McpStepNumber'
import { mcpConnectionFields } from '@/features/api/mcp-connect'

export type McpToolSummary = { readonly name: string; readonly description: string }

export function McpConfigBlock({
  origin,
  token,
  tools,
}: {
  origin: string
  token?: string
  tools: readonly McpToolSummary[]
}) {
  const fields = mcpConnectionFields({ origin, token })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <McpStepNumber value={2} />
          Add bodo to your client
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Your client will ask for a remote or HTTP MCP server. These are the four values it needs,
          whatever it calls them.
        </p>

        <dl className="flex flex-col gap-3">
          {fields.map((field) => (
            <div key={field.id} className="flex flex-col gap-1.5">
              <dt className="text-sm font-medium">{field.label}</dt>
              <dd className="flex items-start gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded border border-border bg-muted px-3 py-2 font-mono text-sm whitespace-pre">
                  {field.value}
                </code>
                <McpCopyButton value={field.copyValue} label={field.label} />
              </dd>
              {field.hint === undefined ? null : (
                <p className="text-xs text-muted-foreground">{field.hint}</p>
              )}
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-medium">What your agent can then do</p>
          <ul className="flex flex-col gap-2">
            {tools.map((tool) => (
              <li key={tool.name} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                <Badge variant="secondary" className="w-fit shrink-0 font-mono">
                  {tool.name}
                </Badge>
                <span className="text-sm text-muted-foreground">{tool.description}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Read-only, every one of them. Nothing reachable over MCP can change your event.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
