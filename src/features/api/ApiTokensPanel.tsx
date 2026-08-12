'use client'

// Event Settings > API Tokens.
//
// **The created-token dialog is the whole design of this screen.** A token exists as a
// readable string exactly once, so the moment it arrives it has to be put somewhere the
// organizer cannot miss and cannot dismiss by accident, with a copy button, and with the
// sentence that it will not be shown again. Everything else here is a table.
//
// Every control is a shadcn component per `.claude/rules/ui-shadcn.md`: `Dialog` for the
// reveal, `AlertDialog` for the destructive revoke, `Table` for the list, `Badge` for state.

import { CopyIcon, KeyIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { createApiTokenAction, revokeApiTokenAction } from '@/features/api/actions'
import type { ApiTokenRow } from '@/types/api-token'

export function ApiTokensPanel({
  eventId,
  tokens,
}: {
  eventId: string
  tokens: readonly ApiTokenRow[]
}) {
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  const create = () => {
    startTransition(async () => {
      const result = await createApiTokenAction(eventId, name)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setName('')
      setCreated(result.token)
    })
  }

  const revoke = (tokenId: string) => {
    startTransition(async () => {
      const result = await revokeApiTokenAction(eventId, tokenId)
      toast[result.ok ? 'success' : 'error'](result.ok ? 'Token revoked' : result.message)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Create a token</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="token-name">Name</Label>
            <Input
              id="token-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
              placeholder="Conference website"
            />
          </div>
          <Button onClick={create} disabled={pending}>
            <KeyIcon />
            Create token
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tokens</CardTitle>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No tokens yet. Create one to read your sessions and speakers over the API.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id}>
                    <TableCell className="font-medium">{token.name}</TableCell>
                    <TableCell>{formatDay(token.createdAt)}</TableCell>
                    {/* The column that makes a token safe to revoke: an organizer holding
                        five needs to know which one anything is still calling. */}
                    <TableCell>{formatDay(token.lastUsedAt) || 'Never'}</TableCell>
                    <TableCell>
                      <Badge variant={token.revokedAt === undefined ? 'secondary' : 'outline'}>
                        {token.revokedAt === undefined ? 'Active' : 'Revoked'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {token.revokedAt === undefined ? (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button variant="ghost" size="sm" disabled={pending}>
                                Revoke
                              </Button>
                            }
                          />
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Revoke {token.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Anything using this token stops working immediately. This cannot be
                                undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => {
                                  revoke(token.id)
                                }}
                              >
                                Revoke
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreatedTokenDialog
        token={created}
        onClose={() => {
          setCreated(undefined)
        }}
      />
    </div>
  )
}

/**
 * The one and only sighting of a token's value.
 *
 * Not a toast, deliberately: a toast dismisses itself, and a credential that scrolls away
 * after four seconds is one the organizer has to revoke and mint again. This has to be
 * closed on purpose.
 */
function CreatedTokenDialog({ token, onClose }: { token?: string; onClose: () => void }) {
  return (
    <Dialog
      open={token !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy your token now</DialogTitle>
          <DialogDescription>
            This is the only time bodo can show you this value. Store it somewhere safe before
            closing this dialog.
          </DialogDescription>
        </DialogHeader>
        <code className="block overflow-x-auto rounded border border-border bg-muted p-3 font-mono text-sm">
          {token}
        </code>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (token !== undefined) {
                void navigator.clipboard.writeText(token)
                toast.success('Token copied')
              }
            }}
          >
            <CopyIcon />
            Copy
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A date, or an empty string.
 *
 * Formatted with an explicit locale and UTC rather than the browser's, for the reason the
 * sidebar chip states: a client rendering a date its own way disagrees with the server that
 * rendered the page around it, which React reports as a hydration mismatch.
 */
function formatDay(iso: string | undefined): string {
  if (iso === undefined) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
