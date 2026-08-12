'use client'

// Step 3 of MCP setup: did anything actually connect?
//
// **This is the only honest test bodo can run.** It cannot reach into an organizer's editor to
// validate a config, and calling its own MCP endpoint from the server would prove that the
// server works, which was never in doubt: what fails is the paste. So the check asks the one
// question whose answer comes from the client: has a request carrying this credential ever
// been let in? `authenticate()` awaits the `lastUsedAt` stamp for exactly this
// (`src/features/api/auth.ts`), and `findApiTokenById` behind the action is uncached, so
// pressing the button twice reads the row twice rather than the same cached copy.
//
// A button rather than a poll. A page that polls Airtable every three seconds while an
// organizer reads their client's documentation is a page that spends a rate-limited budget on
// somebody who has not typed anything yet, and the moment they finish is a moment only they
// know about.

import { CheckCircle2Icon, CircleDashedIcon, PlugZapIcon, TriangleAlertIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { checkApiTokenUseAction } from '@/features/api/actions'
import { McpStepNumber } from '@/features/api/McpStepNumber'
import { connectionState, type McpConnectionState } from '@/features/api/mcp-connect'

export function McpConnectionCheck({ eventId, tokenId }: { eventId: string; tokenId?: string }) {
  const [state, setState] = useState<McpConnectionState | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  const check = () => {
    if (tokenId === undefined) return
    startTransition(async () => {
      const result = await checkApiTokenUseAction(eventId, tokenId)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setState(connectionState(result))
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <McpStepNumber value={3} />
          Check the connection
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Once your client is configured, ask it something: <em>list the events in bodo</em>. Then
          press this. bodo reports whether a request carrying this token has reached it.
        </p>

        <div>
          <Button onClick={check} disabled={pending || tokenId === undefined}>
            <PlugZapIcon />
            {pending ? 'Checking...' : 'Check connection'}
          </Button>
        </div>

        {tokenId === undefined ? (
          <p className="text-sm text-muted-foreground">
            Create or choose a token in step 1 first: this checks one specific credential.
          </p>
        ) : null}

        {state === undefined ? null : <CheckResult state={state} />}
      </CardContent>
    </Card>
  )
}

function CheckResult({ state }: { state: McpConnectionState }) {
  if (state.status === 'connected') {
    return (
      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>Connected</AlertTitle>
        <AlertDescription>
          A client authenticated with this token on {formatMoment(state.at)}. Your setup works.
        </AlertDescription>
      </Alert>
    )
  }

  if (state.status === 'revoked') {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>This token is revoked</AlertTitle>
        <AlertDescription>
          It will never authenticate. Create a new one in step 1 and update your client.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert>
      <CircleDashedIcon />
      <AlertTitle>Nothing has connected yet</AlertTitle>
      <AlertDescription>
        No request has arrived with this token. Check the endpoint and the Authorization header in
        step 2, restart your client so it re-reads its config, then ask it something and check
        again.
      </AlertDescription>
    </Alert>
  )
}

/**
 * The moment, in the reader's own timezone.
 *
 * Local rather than the UTC the token table renders, and that is not an inconsistency: this
 * string only ever appears AFTER a click, so there is no server render for it to disagree
 * with, and "did that just happen" is a question about the clock on the wall in front of you.
 */
function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
