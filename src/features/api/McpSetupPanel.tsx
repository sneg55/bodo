'use client'

// Event Settings > MCP Server: the whole setup, in three steps, on one page.
//
// **The token stays on screen, and that is the reason this page exists rather than a paragraph
// on the API Tokens screen.** A bearer value is readable exactly once, at mint, so the API
// Tokens page shows it in a dialog the organizer must dismiss on purpose. That dialog is right
// there and wrong here: the next thing to do with a new token is paste it into the block
// directly below, and a modal that has to be closed to read that block is a modal that gets
// closed before the value is copied. So step 1 reveals inline, step 2 renders the header with
// the live value in it, and both stay until the page is left.
//
// **Step 1 offers an existing token too, because the second visit is the common one.** An
// organizer who set this up once and is now configuring a second machine has tokens and cannot
// be shown any of them. Selecting one still drives step 3, which is the part they came back
// for; step 2 falls back to a placeholder and says why.
//
// Everything here is a shadcn component per `.claude/rules/ui-shadcn.md`, and the one link out
// is a `Link` rather than a `Button`, because it goes somewhere.

import { KeyIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createApiTokenAction } from '@/features/api/actions'
import { McpConfigBlock, type McpToolSummary } from '@/features/api/McpConfigBlock'
import { McpConnectionCheck } from '@/features/api/McpConnectionCheck'
import { McpCopyButton } from '@/features/api/McpCopyButton'
import { McpStepNumber } from '@/features/api/McpStepNumber'

/** An existing credential, as step 1's picker needs it: no digest, no value, just a name. */
export type McpTokenOption = { readonly id: string; readonly name: string }

export function McpSetupPanel({
  eventId,
  origin,
  tools,
  tokens,
}: {
  eventId: string
  origin: string
  tools: readonly McpToolSummary[]
  tokens: readonly McpTokenOption[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [minted, setMinted] = useState<{ id: string; token: string } | undefined>(undefined)
  const [chosenId, setChosenId] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  // A freshly minted token wins over a picked one: it is the only one whose value can be
  // shown, so step 2 has more to say about it.
  const activeId = minted?.id ?? chosenId

  const create = () => {
    startTransition(async () => {
      const result = await createApiTokenAction(eventId, name)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setName('')
      setMinted({ id: result.id, token: result.token })
      // So the picker below lists it too, for anyone who mints twice in one sitting. The
      // mutation already expired the tokens tag, so this re-read is not a cached one.
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <McpStepNumber value={1} />
            Get a token
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            MCP uses the same read-only tokens as the API. A token reaches every event you are a
            member of, and reading is all it can ever do.
          </p>

          <div className="flex items-end gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="mcp-token-name">Token name</Label>
              <Input
                id="mcp-token-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                }}
                placeholder="Claude on my laptop"
              />
            </div>
            <Button onClick={create} disabled={pending}>
              <KeyIcon />
              Create token
            </Button>
          </div>

          {minted === undefined ? null : (
            <div className="flex flex-col gap-2 rounded border border-border bg-muted/40 p-3">
              <p className="text-sm font-medium">
                Copy this now. bodo stores only a digest and cannot show it again.
              </p>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded border border-border bg-background px-3 py-2 font-mono text-sm">
                  {minted.token}
                </code>
                <McpCopyButton value={minted.token} label="Token" />
              </div>
            </div>
          )}

          {tokens.length === 0 || minted !== undefined ? null : (
            <div className="flex flex-col gap-1.5 border-t border-border pt-4">
              <Label htmlFor="mcp-existing-token">Or check one you already have</Label>
              <Select
                items={Object.fromEntries(tokens.map((token) => [token.id, token.name]))}
                value={chosenId ?? null}
                onValueChange={(next: string | null) => {
                  setChosenId(next ?? undefined)
                }}
              >
                <SelectTrigger id="mcp-existing-token" className="w-full sm:w-80">
                  <SelectValue placeholder="Select a token..." />
                </SelectTrigger>
                <SelectContent>
                  {tokens.map((token) => (
                    <SelectItem key={token.id} value={token.id}>
                      {token.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Its value cannot be shown again, but step 3 can still tell you whether it is
                working.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <McpConfigBlock origin={origin} token={minted?.token} tools={tools} />

      <McpConnectionCheck eventId={eventId} tokenId={activeId} />

      <p className="text-sm text-muted-foreground">
        Ready-made command lines, the REST endpoints and every response shape are in the{' '}
        <Link href="/docs/api" className="underline underline-offset-4">
          API reference
        </Link>
        .
      </p>
    </div>
  )
}
