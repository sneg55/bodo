// Section 1 of the Accelevents surface: Connection.
//
// bodo's version of the vendor's event-mapping step, at event scope. Sessionboard puts
// Integrations at ORGANIZATION scope and maps each event to a remote one underneath;
// bodo has no organization record and already keys remote identity per event through
// `Events.accelEventUrl` and `accelEventId` (BUILD_SPEC 5.7), so the mapping is here.
//
// TWO THINGS ARE BEING REPORTED AT ONCE and they used to be muddled together, which is why
// a card showing `Not set` twice carried a chip reading `Mock` and no way to set anything:
//
//   - CONNECTED is whether this event names a remote one. An organizer fixes it, right here,
//     which is what the header action is for. A card that reports an absence and offers no
//     way to fill it is a diagnostic, not a setting.
//   - SANDBOX is whether anything actually leaves the Worker (`ACCELEVENTS_MOCK`, read
//     through `@/utils/env` inside `integrationSettings()`). Deployment configuration, so
//     the page can only report it, and the badge is worth nothing without the sentence
//     underneath it: `Mock` alone names the flag rather than the consequence.
//
// The technical names have not been dropped, they have been demoted. `Events.accelEventUrl`
// is what somebody reads the Airtable base by when a sync misfires, so it lives in the
// field's tooltip while the row itself carries a human label.
//
// Never a raw `process.env` read here: this component runs on the server today, and a page
// that reads env directly is one refactor away from shipping a config value into a client
// bundle.

import { ExternalLinkIcon, FlaskConicalIcon, InfoIcon } from 'lucide-react'

import { AccelSyncBehaviour } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/AccelSyncBehaviour'
import { ConnectDialog } from '@/app/(admin)/admin/[eventId]/(organizer)/settings/integrations/ConnectDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AccelConnection } from '@/features/integrations/reads'

const LABEL = 'Accelevents'

const URL_HINT =
  'Stored as Events.accelEventUrl. Despite the name it is a path segment, not a page address: every Accelevents request path is built from it, so it is linked here only when an absolute URL was pasted in.'

const ID_HINT =
  'Stored as Events.accelEventId. Some Accelevents endpoints want it; the connection works without it.'

export function AccelConnectionCard({
  eventId,
  connection,
}: {
  eventId: string
  connection: AccelConnection
}) {
  const connected = (connection.eventUrl ?? '') !== ''

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Connection
          <Badge variant={connected ? 'secondary' : 'outline'}>
            {connected ? 'Connected' : 'Not connected'}
          </Badge>
          {connection.mock ? (
            <Tooltip>
              {/* Focusable, so the flag names are reachable without a pointer. The trigger
                  stays a button and the badge sits inside it, rather than rendering the
                  trigger AS the badge, which would leave a span nothing can tab to. */}
              <TooltipTrigger className="cursor-help rounded-4xl">
                <Badge variant="outline">Sandbox</Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                ACCELEVENTS_MOCK is set on this deployment, so every call is answered in-repo.
                Clearing it and setting ACCELEVENTS_API_KEY is what turns it off.
              </TooltipContent>
            </Tooltip>
          ) : null}
        </CardTitle>
        <CardDescription>
          Which {LABEL} event this one pushes its accepted sessions and their speakers into.
        </CardDescription>
        <CardAction>
          <ConnectDialog
            eventId={eventId}
            label={LABEL}
            currentEventUrl={connection.eventUrl}
            currentRemoteEventId={connection.remoteEventId}
            missing={connection.configured ? [] : connection.missing}
          />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {connection.configured ? null : (
          <Alert variant="destructive">
            <AlertTitle>Not configured: {connection.missing.join(', ')}</AlertTitle>
            <AlertDescription>
              Every control below stays disabled until it is set. A sync that starts without it
              fails at the first request and writes a failed row for each entity it was going to
              send.
            </AlertDescription>
          </Alert>
        )}

        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field
            label="Event URL"
            hint={URL_HINT}
            value={connection.eventUrl}
            href={connection.remoteHref}
          />
          <Field label="Event ID" hint={ID_HINT} value={connection.remoteEventId} />
        </dl>

        <Separator />

        <AccelSyncBehaviour />

        {connection.mock ? (
          <Alert>
            <FlaskConicalIcon />
            {/* BUILD_SPEC 5.7's warning, kept because this is the screen somebody is looking
                at when they decide to go live, and cut to the part that changes what they
                should do next. The flag's name belongs to whoever deploys, so it sits in the
                badge's tooltip rather than in copy an organizer reads. */}
            <AlertTitle>Sandbox: nothing reaches {LABEL}</AlertTitle>
            <AlertDescription>
              Syncs run end to end against a stand-in, so the first live run is also the first time
              remote id assignment, duplicate emails and real validation errors are exercised. Point
              it at a test event before an event anyone is registered for.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * One identity field.
 *
 * An absent value says "Not set" rather than rendering blank. A blank cell next to a filled
 * one reads as a display bug, and this pair is exactly what an organizer checks first when
 * a sync refuses to start.
 */
function Field({
  label,
  hint,
  value,
  href,
}: {
  label: string
  hint: string
  value?: string
  href?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        <Tooltip>
          <TooltipTrigger className="text-muted-foreground">
            <InfoIcon className="size-3.5" />
            <span className="sr-only">About {label}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{hint}</TooltipContent>
        </Tooltip>
      </dt>
      <dd className="mt-1 text-sm break-all">
        {value === undefined || value === '' ? (
          <span className="text-muted-foreground">Not set</span>
        ) : href === undefined ? (
          <span className="font-mono">{value}</span>
        ) : (
          <a
            className="inline-flex items-center gap-1 font-mono text-primary underline-offset-4 hover:underline"
            href={href}
            rel="noreferrer noopener"
            target="_blank"
          >
            {value}
            <ExternalLinkIcon className="size-3.5" />
          </a>
        )}
      </dd>
    </div>
  )
}
