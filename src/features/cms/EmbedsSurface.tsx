'use client'

// Ref 32's toolbar and grouped card list.
//
// A client component because all three controls are local state and none of them is worth a
// round trip: the whole list arrives from the server page already (an event has a handful of
// embeds, not a table's worth), so searching and filtering are `embedListModel` over data that
// is already here. That function is where the rules are, and it is tested
// (tests/cms-embed-list.test.ts); this file is the arrangement of the controls over it.
//
// Group headers are `Collapsible` and start open, matching ref 32's up-pointing chevron. Open
// state is per format and lives here, so collapsing a group survives a search but not a
// navigation, which is the behaviour a disclosure normally has.

import { ChevronDownIcon, CodeXmlIcon, SearchIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AddEmbedButton } from '@/features/cms/AddEmbedButton'
import { EmbedCard } from '@/features/cms/EmbedCard'
import {
  EMBED_STATUS_FILTERS,
  EMBED_STATUS_TABS,
  type EmbedListGroup,
  type EmbedStatusFilter,
  embedListModel,
} from '@/features/cms/list-model'
import type { CmsEmbed } from '@/types/cms'
import { cn } from '@/utils/cn'

const STATUS_SET = new Set<string>(EMBED_STATUS_FILTERS)

export function EmbedsSurface({
  eventId,
  embeds,
}: {
  eventId: string
  embeds: readonly CmsEmbed[]
}) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<EmbedStatusFilter>('all')
  const [collapsed, setCollapsed] = useState<readonly string[]>([])

  const model = useMemo(() => embedListModel(embeds, { search, status }), [embeds, search, status])

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search embeds"
            className="pl-8"
            placeholder="Search by name, format, or ID..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>

        <Tabs
          value={status}
          onValueChange={(next: string) => {
            if (STATUS_SET.has(next)) setStatus(next as EmbedStatusFilter)
          }}
        >
          <TabsList>
            {EMBED_STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
                <Badge variant="secondary" className="tabular-nums">
                  {model.counts[tab.id]}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <AddEmbedButton eventId={eventId} />
      </div>

      {model.groups.length === 0 ? (
        <EmptyState hasEmbeds={embeds.length > 0} />
      ) : (
        model.groups.map((group) => (
          <FormatGroup
            key={group.format}
            eventId={eventId}
            group={group}
            open={!collapsed.includes(group.format)}
            onOpenChange={(open) => {
              setCollapsed((current) =>
                open
                  ? current.filter((format) => format !== group.format)
                  : [...current, group.format],
              )
            }}
          />
        ))
      )}
    </div>
  )
}

function FormatGroup({
  eventId,
  group,
  open,
  onOpenChange,
}: {
  eventId: string
  group: EmbedListGroup
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        render={<Button variant="ghost" className="hit-area-y w-full justify-start gap-2 px-2" />}
      >
        <CodeXmlIcon className="shrink-0 text-muted-foreground" />
        <span className="font-medium">{group.label}</span>
        <Badge variant="secondary" className="tabular-nums">
          {group.count}
        </Badge>
        <ChevronDownIcon
          className={cn('ml-auto shrink-0 transition-transform', open ? '' : '-rotate-90')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
        {group.rows.map((row) => (
          <EmbedCard key={row.id} eventId={eventId} row={row} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Two states behind one card: nothing created yet, and nothing matching.
 *
 * Distinguished because they need opposite next actions, and telling an organizer with three
 * embeds that they have none is how a search box gets reported as a data-loss bug.
 */
function EmptyState({ hasEmbeds }: { hasEmbeds: boolean }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <CodeXmlIcon className="size-6 text-muted-foreground" />
        <p className="font-medium">{hasEmbeds ? 'No matching embeds' : 'No embeds yet'}</p>
        <p className="text-pretty text-sm text-muted-foreground">
          {hasEmbeds
            ? 'Try a different name, format, or ID.'
            : 'Add an embed to place your agenda, sessions, or speakers on your website.'}
        </p>
      </CardContent>
    </Card>
  )
}
