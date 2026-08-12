'use client'

// Step: credentials. One step, three genuinely different questions. BUILD_SPEC 5.0e.
//
// Sessionize asks for an endpoint id, which is NOT a secret: the organizer creates the
// endpoint on their event's API / Embed page, sets its format to JSON, and the URL is
// unauthenticated because "the data being accessed is essentially an event schedule".
//
// Sessionboard asks for a region, an organization token and a source event. THE TOKEN IS
// NEVER STORED: it lives in this tab, travels in the body of each action, and is gone when
// the run ends, so a re-run asks again. That is a deliberate ergonomic cost and it is
// smaller than a token sitting in an Airtable base every collaborator on the event can open
// (5.0e, "Secrets").
//
// Accelevents asks for nothing, because there is nothing to ask: the key is deployed and
// the remote event is already on the event record from §5.7. The step still renders, and
// what it renders is the identity about to be pulled from plus the round-trip warning,
// which is the one thing an organizer here can get catastrophically wrong.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  listSessionboardEventsAction,
  type SessionboardEventOption,
} from '@/features/imports/actions'
import type { ImportCredentials } from '@/features/imports/wizard-steps'
import {
  SESSIONBOARD_REGION_LABELS,
  SESSIONBOARD_REGIONS,
  type SessionboardRegion,
} from '@/services/imports/sessionboard'
import type { ImportSource } from '@/types/imports'

// Through a Map, like every other label lookup in this codebase: a record indexed by a
// variable is what `security/detect-object-injection` exists to flag.
const REGION_LABEL = new Map<string, string>(Object.entries(SESSIONBOARD_REGION_LABELS))

const REGION_ITEMS = SESSIONBOARD_REGIONS.map((region) => ({
  value: region,
  label: REGION_LABEL.get(region) ?? region,
}))

export type CredentialsStepProps = {
  eventId: string
  source: ImportSource
  credentials: ImportCredentials
  onChange: (next: ImportCredentials) => void
  disabled: boolean
}

export function CredentialsStep(props: CredentialsStepProps) {
  if (props.source === 'sessionize') return <SessionizeFields {...props} />
  if (props.source === 'sessionboard') return <SessionboardFields {...props} />
  return <AcceleventsFields {...props} />
}

function SessionizeFields({ credentials, onChange, disabled }: CredentialsStepProps) {
  return (
    <div className="flex max-w-lg flex-col gap-2">
      <Label htmlFor="sessionize-endpoint">Endpoint id</Label>
      <Input
        id="sessionize-endpoint"
        value={credentials.endpointId}
        placeholder="jl4ktls0"
        disabled={disabled}
        onChange={(event) => {
          onChange({ ...credentials, endpointId: event.target.value })
        }}
      />
      <p className="text-xs text-muted-foreground">
        On your Sessionize event, open API / Embed, create an endpoint with the format set to JSON,
        and copy the id out of its URL. It is not a token and it is not a secret: the endpoint is
        public.
      </p>
      <Alert>
        <AlertTitle>Sessionize carries no email addresses</AlertTitle>
        <AlertDescription>
          Their speaker record has no email field, so this import brings the programme and the
          speaker profiles but not addresses anyone can be contacted at. The run finishes with a
          Needs email list, one row per speaker, to fill in before any invite is sent.
        </AlertDescription>
      </Alert>
    </div>
  )
}

/**
 * The event is PICKED rather than typed, and that is not a convenience.
 *
 * Their event id is a bare integer with no checksum, so a typo resolves to a real event
 * belonging to the same organization, and the import would then pull somebody else's
 * conference into this one with no error at any layer. The list is fetched with the token
 * that was just pasted, and neither is kept.
 */
function SessionboardFields({ eventId, credentials, onChange, disabled }: CredentialsStepProps) {
  const [events, setEvents] = useState<readonly SessionboardEventOption[]>([])
  const [pending, startTransition] = useTransition()

  const loadEvents = () => {
    startTransition(async () => {
      const result = await listSessionboardEventsAction({
        eventId,
        region: credentials.region,
        token: credentials.token,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setEvents(result.events)
      if (result.events.length === 0) toast.warning('This token can see no events.')
    })
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="sessionboard-region">Region</Label>
        <Select
          value={credentials.region}
          items={REGION_ITEMS}
          disabled={disabled}
          onValueChange={(next: string | null) => {
            if (next === null) return
            // The event list belongs to the old host, so it is dropped rather than left
            // showing ids that do not exist on the new one.
            setEvents([])
            onChange({
              ...credentials,
              region: next as SessionboardRegion,
              remoteEventId: '',
            })
          }}
        >
          <SelectTrigger id="sessionboard-region" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REGION_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Sessionboard serves two independent bases. A European token presented to the United States
          host answers 401 rather than telling you the region is wrong.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="sessionboard-token">Organization API token</Label>
        <Input
          id="sessionboard-token"
          type="password"
          autoComplete="off"
          value={credentials.token}
          placeholder="x-access-token"
          disabled={disabled}
          onChange={(event) => {
            setEvents([])
            onChange({ ...credentials, token: event.target.value, remoteEventId: '' })
          }}
        />
        <p className="text-xs text-muted-foreground">
          Generated in Sessionboard under Organization Settings, API Tokens. bodo does not store it:
          it is used for this run and then forgotten, so a later import asks for it again.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="sessionboard-event">Source event</Label>
        <div className="flex items-center gap-2">
          <Select
            value={credentials.remoteEventId === '' ? null : credentials.remoteEventId}
            items={events.map((event) => ({ value: event.id, label: event.name }))}
            disabled={disabled || events.length === 0}
            onValueChange={(next: string | null) => {
              onChange({ ...credentials, remoteEventId: next ?? '' })
            }}
          >
            <SelectTrigger id="sessionboard-event" className="w-full">
              <SelectValue placeholder="Load events first" />
            </SelectTrigger>
            <SelectContent>
              {events.map((event) => (
                <SelectItem key={event.id} value={event.id}>
                  {event.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={disabled || pending || credentials.token.trim() === ''}
            onClick={loadEvents}
          >
            Load events
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Nothing to enter, and one thing to be warned about.
 *
 * Accelevents is the only provider bodo also pushes TO, so pulling from the same remote
 * event bodo has been pushing into would re-import bodo's own writes. The guard is real
 * rather than advice: `IntegrationMappings` records every remote id bodo authored, those
 * rows are skipped, and the preview names how many, so a round trip is a visible number
 * rather than a silent duplication.
 */
function AcceleventsFields({ credentials }: CredentialsStepProps) {
  if (credentials.acceleventsRef === '') {
    return (
      <Alert variant="destructive">
        <AlertTitle>This event is not mapped to an Accelevents event</AlertTitle>
        <AlertDescription>
          The remote identity lives on the event record as accelEventUrl and accelEventId, and this
          build has no editor for those two fields, so they are set in the base. Until one is there,
          there is nothing for this import to read.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Reading from</span>
        <span className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
          {credentials.acceleventsRef}
        </span>
        <p className="text-xs text-muted-foreground">
          Taken from this event record. The API key is deployment configuration, so there is nothing
          to enter here.
        </p>
      </div>

      <Alert>
        <AlertTitle>Anything bodo pushed here is skipped on the way back</AlertTitle>
        <AlertDescription>
          This is the one provider bodo also syncs out to. Sessions bodo created on the far side are
          recognised and left alone, and the preview counts them as skipped, so pulling an event you
          have been syncing all week does not duplicate it.
        </AlertDescription>
      </Alert>
    </div>
  )
}
