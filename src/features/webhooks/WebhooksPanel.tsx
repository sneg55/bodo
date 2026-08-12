'use client'

// Event Settings > Webhooks.
//
// Two things here are decisions rather than layout.
//
// **The URL is shown as its origin and nothing else.** A Discord incoming-webhook URL ends in
// a token, so it is a credential in the shape of a link, and rendering the whole string puts
// it on a screen an organizer shares, screenshots and projects. The origin identifies the
// endpoint to whoever added it and is the half that is not secret. Same call
// tables-webhooks.ts makes about the primary field.
//
// **The signing secret appears once, in a dialog that has to be dismissed on purpose.** Not a
// toast: a credential that fades after four seconds is one the organizer has to delete and
// re-create, and re-creating it means changing whatever verifies `X-Bodo-Signature` on the
// other end. `WebhookListRow` carries no `secret` at all, so this cannot be re-rendered from
// the list later even by accident.
//
// Every control is shadcn per `.claude/rules/ui-shadcn.md`: `Dialog` to add, `AlertDialog` for
// the destructive delete, `Checkbox` per event type, `Switch` to mute, `Table`, `Badge`.

import { CopyIcon, PlusIcon } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AddWebhookDialog } from '@/features/webhooks/AddWebhookDialog'
import {
  createWebhookAction,
  deleteWebhookAction,
  setWebhookEnabledAction,
} from '@/features/webhooks/actions'
import type { WebhookFormInput, WebhookListRow } from '@/types/webhook'

const EMPTY_COPY =
  'No endpoints yet. Add one to POST submissions, tasks and published sessions to your own service or a Discord channel.'

export function WebhooksPanel({
  eventId,
  webhooks,
}: {
  eventId: string
  webhooks: readonly WebhookListRow[]
}) {
  const [adding, setAdding] = useState(false)
  const [secret, setSecret] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  const run = (work: () => Promise<{ ok: boolean; message?: string }>, done: string) => {
    startTransition(async () => {
      const result = await work()
      toast[result.ok ? 'success' : 'error'](result.ok ? done : (result.message ?? 'Failed'))
    })
  }

  const add = (input: WebhookFormInput) => {
    startTransition(async () => {
      const result = await createWebhookAction(eventId, input)
      if (!result.ok) return void toast.error(result.message)
      setAdding(false)
      setSecret(result.secret)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Endpoints</CardTitle>
          <Button disabled={pending} onClick={() => setAdding(true)}>
            <PlusIcon />
            Add endpoint
          </Button>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{EMPTY_COPY}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Last delivery</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="font-mono text-xs">{originOf(row.url)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.events.map((type) => (
                          <Badge key={type} variant="outline" className="font-mono text-[11px]">
                            {type}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {lastDelivery(row)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={row.enabled}
                        disabled={pending}
                        onCheckedChange={(next: boolean) =>
                          run(
                            () => setWebhookEnabledAction(eventId, row.id, next),
                            next ? 'Endpoint enabled' : 'Endpoint muted',
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button variant="ghost" size="sm" disabled={pending}>
                              Delete
                            </Button>
                          }
                        />
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {row.name}?</AlertDialogTitle>
                            {/* Says what is actually lost. The secret is the part an organizer
                                cannot get back, and muting is the thing they usually wanted. */}
                            <AlertDialogDescription>
                              Its signing secret goes too, so adding this endpoint back means
                              updating whatever verifies the signature. To stop deliveries and keep
                              the secret, turn Enabled off instead.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                run(() => deleteWebhookAction(eventId, row.id), 'Endpoint deleted')
                              }
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {adding ? (
        <AddWebhookDialog pending={pending} onClose={() => setAdding(false)} onAdd={add} />
      ) : null}
      <SecretDialog secret={secret} onClose={() => setSecret(undefined)} />
    </div>
  )
}

/** The one and only sighting of a signing secret. See the file header for why it is a dialog. */
function SecretDialog({ secret, onClose }: { secret?: string; onClose: () => void }) {
  return (
    <Dialog open={secret !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy your signing secret now</DialogTitle>
          <DialogDescription>
            Every delivery carries an X-Bodo-Signature header, which is an HMAC-SHA256 of the
            request body under this key. This is the only time bodo shows it to you.
          </DialogDescription>
        </DialogHeader>
        <code className="block overflow-x-auto rounded border border-border bg-muted p-3 font-mono text-sm">
          {secret}
        </code>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (secret !== undefined) {
                void navigator.clipboard.writeText(secret)
                toast.success('Secret copied')
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

/** The identifying half of the URL, without the token half. See the file header. */
function originOf(url: string): string {
  if (!URL.canParse(url)) return url
  const parsed = new URL(url)
  return parsed.pathname === '/' ? parsed.origin : `${parsed.origin}/…`
}

/**
 * "404 on Aug 11, 2026", or "Never". The status is text because the failures worth seeing have
 * no number (a timeout, a refused connection), which is why the date shows without one.
 *
 * An explicit locale and UTC, never the browser's: a client formatting a date its own way
 * disagrees with the server that rendered the page around it, and React calls that a
 * hydration mismatch.
 */
function lastDelivery(row: WebhookListRow): string {
  if (row.lastAttemptAt === undefined) return 'Never'
  const day = new Date(row.lastAttemptAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  return (row.lastStatus ?? '') === '' ? day : `${row.lastStatus ?? ''} on ${day}`
}
