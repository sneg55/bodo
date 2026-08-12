// /admin/[eventId]/settings: the Event Settings shell.
//
// The page header band and the sub-navigation column from docs/parity/event-config.md
// ref 02, wrapped around every settings page so the chrome does not re-render or flicker
// between sections. Title and subtitle are transcribed verbatim.
//
// No guard here. `(admin)/admin/[eventId]/layout.tsx` above this reads the session in its
// own body and redirects before the first byte, which is where a redirect belongs; each
// page below checks `isSettingsOrganizer` and renders nothing rather than redirecting from
// inside the `loading.tsx` boundary next door.

import { ArrowLeftIcon, SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { PageHeader } from '@/components/primitives/PageHeader'
import { SettingsSubNav } from '@/features/settings/SettingsSubNav'

export const metadata = { title: 'Event Settings' }

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ eventId: string }>
}) {
  const { eventId } = await params

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={SettingsIcon}
        title="Event Settings"
        description="Configure event details and preferences"
        leading={
          <ButtonLink href={`/admin/${eventId}`} variant="ghost" size="icon" aria-label="Back">
            <ArrowLeftIcon />
          </ButtonLink>
        }
      />

      <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:gap-8">
        <SettingsSubNav eventId={eventId} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
