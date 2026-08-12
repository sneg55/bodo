// `/docs/api`: the public reference for R10's REST API and the MCP server.
//
// A real page rather than a README, and public rather than behind the admin shell, because
// the person integrating against this is often not the person who holds the bodo login: an
// organizer pastes this URL to whoever builds their conference site. It is also the first
// thing anyone evaluating the API will open, so it carries copy-paste `curl` for every
// endpoint rather than a prose description of them.
//
// Every example is built from `appUrl()` rather than hardcoded, so a self-hosted deployment
// documents its own origin instead of somebody else's.

import { KeyIcon, TerminalIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DEFAULT_SIZE, MAX_SIZE } from '@/features/api/pagination'
import { appUrl } from '@/utils/env'

export const metadata = {
  title: 'bodo API',
  description: 'REST and MCP access to your sessions and speakers.',
}

export default function ApiDocsPage() {
  const origin = appUrl()

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">bodo API</h1>
        <p className="text-muted-foreground">
          Read your published sessions and announced speakers from anywhere. Create a token in{' '}
          <strong>Event Settings &gt; API Tokens</strong>.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyIcon className="size-4" />
            Authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Every request carries a bearer token. Tokens are shown once, when you create them, and
            are stored only as a SHA-256 digest, so bodo cannot show you one again.
          </p>
          <Snippet>{`curl -H "Authorization: Bearer bodo_..." \\\n  ${origin}/api/v1/events`}</Snippet>
          <p className="text-muted-foreground">
            A token reaches every event its creator is a member of. Removing someone from an event
            removes their tokens&apos; access to it on the next request.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 text-sm">
          <Endpoint
            path="/api/v1/events"
            summary="Every event this token can see. Start here: the other endpoints are addressed by slug."
            origin={origin}
          />
          <Endpoint
            path="/api/v1/events/{slug}/sessions"
            example="/api/v1/events/ai-engineer-worlds-fair/sessions"
            summary="The published schedule, in start order, with room and track resolved to names. Sessions that are not published, not accepted, cancelled, or whose content is not approved are not returned."
            origin={origin}
          />
          <Endpoint
            path="/api/v1/events/{slug}/speakers"
            example="/api/v1/events/ai-engineer-worlds-fair/speakers"
            summary="Speakers appearing on the published schedule. No email or phone is returned."
            origin={origin}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pagination</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Every collection takes <code className="font-mono">page</code> (1-based) and{' '}
            <code className="font-mono">size</code> (default {DEFAULT_SIZE}, max {MAX_SIZE}).
            Out-of-range values are clamped rather than refused, and a page past the end is an empty
            array. <code className="font-mono">total</code> counts the whole collection.
          </p>
          <Snippet>{`{ "data": [ ... ], "page": 1, "size": ${String(DEFAULT_SIZE)}, "total": 214 }`}</Snippet>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TerminalIcon className="size-4" />
            MCP server
            <Badge variant="secondary">Beta</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            The same data, over the Model Context Protocol, so your own agent can answer questions
            about the conference. Read-only, and authenticated with the same token.
          </p>
          <Snippet>{`claude mcp add bodo --transport http ${origin}/api/v1/mcp \\\n  --header "Authorization: Bearer bodo_..."`}</Snippet>
          <p className="text-muted-foreground">
            Tools: <code className="font-mono">list_events</code>,{' '}
            <code className="font-mono">list_sessions</code>,{' '}
            <code className="font-mono">list_speakers</code>,{' '}
            <code className="font-mono">outstanding_tasks</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Errors</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            <strong>401</strong> for a missing, unknown or revoked token. <strong>404</strong> for
            an event that does not exist or that your token cannot see: the two are deliberately
            indistinguishable, so this API cannot be used to discover other organizers&apos; events.
          </p>
          <Snippet>{`{ "error": { "id": "E_DATA_001", "message": "no event with slug ..." } }`}</Snippet>
        </CardContent>
      </Card>
    </main>
  )
}

function Endpoint({
  path,
  example,
  summary,
  origin,
}: {
  path: string
  example?: string
  summary: string
  origin: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono">
          GET
        </Badge>
        <code className="font-mono text-sm">{path}</code>
      </div>
      <p className="text-muted-foreground">{summary}</p>
      <Snippet>{`curl -H "Authorization: Bearer $BODO_TOKEN" \\\n  ${origin}${example ?? path}`}</Snippet>
    </div>
  )
}

/** A copyable block. `overflow-x-auto` so a long URL scrolls itself and not the page. */
function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded border border-border bg-muted p-3 font-mono text-xs">
      {children}
    </pre>
  )
}
