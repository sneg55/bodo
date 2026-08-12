'use client'

// One portal's editor: the settings card, then one content card per kind in portal order,
// then one Save that covers the page.
//
// TWO WRITES, ONE BUTTON, and the order matters. `savePortalAction` goes first because it is
// the one that can refuse: it rejects a save that would leave the event without exactly one
// default portal, and committing the content on top of a portal row that was never written
// would leave the two halves of the screen describing different states. If the items write
// then fails, the settings are already saved and the toast says which half is outstanding,
// rather than claiming the whole page failed.
//
// The content cards are behind `next/dynamic` because they carry @dnd-kit, which is imported
// at the component that needs it and never at a layout.
//
// The rows posted back are only the ones an organizer has touched (`portalItemWrites`). An
// untouched task must not gain a `PortalItems` row, because absence means SHOWN for the three
// assignable kinds and writing today's default into the base would freeze it for surfaces
// nobody has looked at.

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { savePortalAction, savePortalItemsAction } from '@/features/portal-config/actions'
import type { PortalContent } from '@/features/portal-config/content'
import { settled } from '@/features/portal-config/settled'
import type { Portal } from '@/types/portals'

import type { FilterOption } from './PortalFilterEditor'
import { PortalSettingsCard, type PortalSettingsDraft } from './PortalSettingsCard'
import {
  PORTAL_ITEM_KINDS,
  portalContentRows,
  portalItemWrites,
  withPortalContentRows,
} from './portal-item-kinds'

const PortalContentCard = dynamic(
  () => import('./PortalContentCard').then((module) => module.PortalContentCard),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full rounded-xl" /> },
)

export type PortalContentEditorProps = {
  eventId: string
  portal: Portal
  content: PortalContent
  /** Assignments per source record, for Tasks and File Requests. Ids are unique across kinds. */
  assigned: readonly { itemId: string; count: number }[]
  tracks: readonly FilterOption[]
  tags: readonly FilterOption[]
}

export function PortalContentEditor({
  eventId,
  portal,
  content,
  assigned,
  tracks,
  tags,
}: PortalContentEditorProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<PortalSettingsDraft>({
    name: portal.name,
    contactTypes: portal.filters.contactTypes,
    rules: portal.filters.rules,
    welcomeMessage: portal.welcomeMessage ?? '',
    alwaysShowTasks: portal.alwaysShowTasks,
    manageProfile: portal.manageProfile,
  })
  const [rows, setRows] = useState(content)

  const assignedByItem = new Map(assigned.map((entry) => [entry.itemId, entry.count]))

  function save(): void {
    startTransition(async () => {
      // Both calls go through `settled`, so a rejection lands on the `!ok` branch that is
      // already here rather than escaping the transition. Without it a 500 left Save
      // disabled with nothing said: `isPending` never cleared. See ../portal-config/settled.ts.
      const saved = await settled(
        savePortalAction({
          eventId,
          portalId: portal.id,
          name: draft.name,
          filters: { contactTypes: draft.contactTypes, rules: draft.rules },
          welcomeMessage: draft.welcomeMessage,
          alwaysShowTasks: draft.alwaysShowTasks,
          manageProfile: draft.manageProfile,
        }),
      )
      if (!saved.ok) {
        toast.error(saved.error)
        return
      }

      const items = await settled(
        savePortalItemsAction({
          eventId,
          portalId: portal.id,
          rows: portalItemWrites(rows),
        }),
      )
      if (!items.ok) {
        toast.error(items.error, { description: 'The portal settings were saved.' })
        return
      }

      toast.success('Saved successfully')
      router.refresh()
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PortalSettingsCard
        draft={draft}
        onChange={(patch) => {
          setDraft({ ...draft, ...patch })
        }}
        isDefault={portal.isDefault}
        tracks={tracks}
        tags={tags}
        disabled={pending}
      />

      {PORTAL_ITEM_KINDS.map((kind) => (
        <PortalContentCard
          key={kind.itemType}
          eventId={eventId}
          itemType={kind.itemType}
          rows={portalContentRows(rows, kind.itemType)}
          onChange={(next) => {
            setRows(withPortalContentRows(rows, kind.itemType, next))
          }}
          assigned={kind.assignable ? assignedByItem : undefined}
          disabled={pending}
        />
      ))}

      <div className="flex justify-end">
        <Button disabled={pending} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  )
}
