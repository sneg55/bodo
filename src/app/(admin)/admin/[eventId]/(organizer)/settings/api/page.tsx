// Event Settings > API Tokens (R10).
//
// The digest is dropped before the list crosses into the client component, and that is not
// tidiness: a hash rendered into the page source is a value somebody will eventually treat as
// a credential, and it is of no use to this screen. `ApiTokenRow` is the type that makes that
// impossible to forget.
//
// **The list is the VIEWER's tokens, not the base's.** `ApiTokens` has no event link, so
// administering the event in the URL says nothing about who a row belongs to; scoping by
// `userId` is the only thing standing between this page and every organizer's credentials.
// `requireAdminUser` is called for the id rather than for the check: `isSettingsOrganizer`
// above already resolved an admin session, so this cannot throw where that returned true.

import { ApiTokensPanel } from '@/features/api/ApiTokensPanel'
import { requireAdminUser } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import { isSettingsOrganizer } from '@/features/settings/authorize'
import { listApiTokens } from '@/services/airtable/reads-api'

export const metadata = { title: 'API Tokens' }

export default async function ApiTokensPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  if (!(await isSettingsOrganizer(eventId))) return null

  const { userId } = await requireAdminUser()
  const tokens = await listApiTokens(userId)

  return (
    <ApiTokensPanel
      eventId={eventId}
      tokens={tokens.map(({ tokenHash: _tokenHash, ...row }) => row)}
    />
  )
}
