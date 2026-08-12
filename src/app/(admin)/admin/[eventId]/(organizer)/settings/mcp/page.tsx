// Event Settings > MCP Server (R10).
//
// The shape is the API Tokens page's, because it reads the same rows under the same rule: the
// list is the VIEWER's tokens and not the base's. `ApiTokens` carries no event link, so
// administering the event named in the URL says nothing about who a row belongs to, and
// scoping by `userId` is the only thing standing between this page and every organizer's
// credentials. No digest and no `ownerId` crosses into the client component either; the picker
// needs an id and a name and is given exactly that.
//
// **`MCP_TOOLS` is read HERE rather than in the panel, and that is a bundle boundary.** Each
// tool's `run` reaches `services/airtable/queries`, so importing the module into a client
// component to render four names would drag the DAL into the browser. The descriptors are
// mapped to plain strings at this line and never travel as functions.
//
// Revoked tokens are filtered out of the picker: offering one would be offering a credential
// whose only possible answer in step 3 is that it is dead.

import { McpSetupPanel } from '@/features/api/McpSetupPanel'
import { MCP_TOOLS } from '@/features/api/mcp-tools'
import { requireAdminUser } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import { isSettingsOrganizer } from '@/features/settings/authorize'
import { listApiTokens } from '@/services/airtable/reads-api'
import { appUrl } from '@/utils/env'

export const metadata = { title: 'MCP Server' }

export default async function McpSetupPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  // Renders nothing rather than redirecting: this page sits under `settings/loading.tsx`, and
  // a `redirect()` resolving after the shell has flushed is a hung request on Workers.
  if (!(await isSettingsOrganizer(eventId))) return null

  const { userId } = await requireAdminUser()
  const tokens = await listApiTokens(userId)

  return (
    <McpSetupPanel
      eventId={eventId}
      origin={appUrl()}
      tools={MCP_TOOLS.map(({ name, description }) => ({ name, description }))}
      tokens={tokens
        .filter((token) => token.revokedAt === undefined)
        .map((token) => ({ id: token.id, name: token.name }))}
    />
  )
}
