'use client'

// The Add endpoint dialog, split out of WebhooksPanel.tsx.
//
// Its own file for the reason `SaveSpeakerListDialog.tsx` is: the panel is a table plus its
// controls, and the form that creates a row is a separate piece of state (four fields, none of
// which the table has any use for) that lives only while the dialog is open. Keeping it inline
// also put the panel over the 300-line ceiling the file-size hook enforces.
//
// Nothing here validates the URL. That is deliberate and not an omission: the Server Action
// does it (`requireHttpUrl` in ./actions.ts), because an action is reachable by POST with no
// dialog ever rendering, and a check that lives only in the browser is decoration. What the
// disabled Add button covers is the two mistakes worth catching before a round trip: no URL at
// all, and no event types ticked.

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Switch } from '@/components/ui/switch'
import { WEBHOOK_EVENT_TYPES } from '@/features/webhooks/dispatch'
import type { WebhookFormInput } from '@/types/webhook'

export function AddWebhookDialog({
  pending,
  onClose,
  onAdd,
}: {
  pending: boolean
  onClose: () => void
  onAdd: (input: WebhookFormInput) => void
}) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [events, setEvents] = useState<readonly string[]>([])

  const toggle = (type: string, on: boolean) =>
    setEvents((current) => (on ? [...current, type] : current.filter((entry) => entry !== type)))

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add endpoint</DialogTitle>
          <DialogDescription>
            bodo POSTs a signed JSON body to this URL. A Discord webhook URL gets Discord&apos;s own
            message shape instead, so it can be pasted straight in.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="webhook-url">URL</Label>
          <Input
            id="webhook-url"
            value={url}
            placeholder="https://example.com/hooks/bodo"
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          {/* Optional. Left blank, the action names the row after the URL's host, because two
              Discord endpoints are otherwise the same string in every chip in the base. */}
          <Label htmlFor="webhook-name">Name</Label>
          <Input
            id="webhook-name"
            value={name}
            placeholder="Program team Discord"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          {/* The raw event names rather than prose labels. They are the strings that arrive in
              `X-Bodo-Event` and in the payload's `type`, so whoever is writing the receiver is
              reading the value they will branch on. */}
          <Label>Events</Label>
          {WEBHOOK_EVENT_TYPES.map((type) => (
            <div key={type} className="flex items-center gap-2">
              <Checkbox
                id={`webhook-event-${type}`}
                checked={events.includes(type)}
                onCheckedChange={(checked: boolean) => toggle(type, checked)}
              />
              <Label htmlFor={`webhook-event-${type}`} className="font-mono text-xs font-normal">
                {type}
              </Label>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="webhook-enabled">Enabled</Label>
          <Switch id="webhook-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || url.trim() === '' || events.length === 0}
            onClick={() => onAdd({ url, name, events: [...events], enabled })}
          >
            Add endpoint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
