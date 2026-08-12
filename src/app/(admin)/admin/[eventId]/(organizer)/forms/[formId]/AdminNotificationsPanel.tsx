'use client'

// The "Admin notifications" panel on step 7 (parity ref 15), with its two templates.
//
// The screenshot shows this panel COLLAPSED, with an orange shield icon, the sub-line
// "2 templates" and a right-facing chevron, and the parity doc's inferred behaviour reads it
// as "expands or navigates to two admin-facing templates (likely new-submission and
// updated-submission alerts, matching the two recipient questions)". It expands, because the
// two templates are two bodies rather than a screen, and it starts collapsed the way the
// capture shows.
//
// Collapsed also decides when the read happens: the rows are loaded on FIRST OPEN rather than
// with the step. They are event-scoped rows in a different table from the form, so loading
// them eagerly would put an Airtable read behind step 7 for every organizer who walks the
// wizard without touching these.
//
// The event id comes from the route rather than a prop, and that is worth stating. The
// builder's step components are handed a `FormDraft` and patch it; these two templates are
// NOT part of that draft (they are event-scoped, in `EmailTemplates`, saved by their own
// action), so threading them through the draft would put a value in it that the form's save
// must then be careful not to write. `useParams` reads the `[eventId]` this panel is already
// rendered under.

import { ShieldAlertIcon } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminTemplateSheet } from '@/features/comms/AdminTemplateSheet'
import { loadAdminTemplatesAction } from '@/features/comms/template-actions'
import type { AdminTemplateValue } from '@/features/comms/template-write'

import { NotificationTemplateRow } from './NotificationTemplateRow'

export function AdminNotificationsPanel() {
  // `string` because this component only ever renders under `/admin/[eventId]/forms/[formId]`.
  const eventId = String(useParams<{ eventId: string }>().eventId)

  const [templates, setTemplates] = useState<readonly AdminTemplateValue[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [pending, start] = useTransition()

  function open(next: boolean): void {
    if (!next || loaded || pending) return
    start(async () => {
      const result = await loadAdminTemplatesAction({ eventId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setTemplates(result.templates)
      setLoaded(true)
    })
  }

  function replace(saved: AdminTemplateValue): void {
    setTemplates((current) => current.map((entry) => (entry.key === saved.key ? saved : entry)))
    setEditing(undefined)
  }

  return (
    <Card className="gap-2 px-4 py-3">
      <Collapsible onOpenChange={open}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 text-left">
          {/* The reference draws this shield orange. bodo's token layer has no warning
              colour (globals.css), and hardcoding one would break in dark mode and defeat
              the point of the tokens, so the icon carries the shape and not the hue. */}
          <ShieldAlertIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-semibold">Admin notifications</span>
          <span className="ml-auto text-xs text-muted-foreground">2 templates</span>
        </CollapsibleTrigger>

        <CollapsibleContent className="flex flex-col gap-3 pt-3">
          {loaded ? (
            templates.map((template) => (
              <NotificationTemplateRow
                key={template.key}
                icon={<ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                title={
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {template.title}
                    {template.customized ? <Badge variant="secondary">Customized</Badge> : null}
                  </span>
                }
                description={template.description}
                controls={
                  <Button variant="outline" size="sm" onClick={() => setEditing(template.key)}>
                    Customize
                  </Button>
                }
              />
            ))
          ) : (
            <Skeleton className="h-16 w-full rounded-lg" />
          )}
        </CollapsibleContent>
      </Collapsible>

      <AdminTemplateSheet
        eventId={eventId}
        template={templates.find((entry) => entry.key === editing)}
        onSaved={replace}
        onClose={() => setEditing(undefined)}
      />
    </Card>
  )
}
