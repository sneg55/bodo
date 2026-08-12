'use client'

// Settings > Email Templates: every email this event sends, and which ones have been
// rewritten.
//
// The rows come from the server already resolved, so this component does no reading. What
// is local is what is genuinely local: which row the drawer is editing, and the saved value
// replacing the one it opened on, so the Customized badge moves without a navigation.
//
// The Sheet is the builder's, imported rather than reimplemented: both surfaces write the
// same `EmailTemplates` rows through the same authorized action, and a second editor would
// be a second place for the merge-field validation to be missing.
//
// Not captured in any screenshot. The parity docs record the sub-nav entry and nothing
// behind it, so the grouping and copy here are authored, and the two group titles say what
// the group is rather than dressing it up.

import { MailIcon, ShieldAlertIcon } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AdminTemplateSheet } from '@/features/comms/AdminTemplateSheet'
import type { AdminTemplateValue } from '@/features/comms/template-write'

export type EmailTemplatesPanelProps = {
  eventId: string
  speaker: readonly AdminTemplateValue[]
  admin: readonly AdminTemplateValue[]
}

export function EmailTemplatesPanel({ eventId, speaker, admin }: EmailTemplatesPanelProps) {
  const [values, setValues] = useState<readonly AdminTemplateValue[]>([...speaker, ...admin])
  const [editing, setEditing] = useState<string | undefined>(undefined)

  const of = (source: readonly AdminTemplateValue[]) =>
    source.map((row) => values.find((value) => value.key === row.key) ?? row)

  return (
    <div className="flex flex-col gap-6">
      <Group
        title="Speaker emails"
        description="Sent to speakers by the decision and reminder triggers"
        icon={<MailIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        rows={of(speaker)}
        onCustomize={setEditing}
      />

      <Group
        title="Admin alerts"
        description="Sent to the recipients configured on each submission form"
        icon={<ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        rows={of(admin)}
        onCustomize={setEditing}
      />

      <p className="text-sm text-pretty text-muted-foreground">
        The draft reminder is not listed. Its built-in message names how long is left before the
        form closes, which differs per reminder, so there is no fixed body to show here.
      </p>

      <AdminTemplateSheet
        eventId={eventId}
        template={values.find((value) => value.key === editing)}
        onSaved={(saved) => {
          setValues((current) => current.map((entry) => (entry.key === saved.key ? saved : entry)))
          setEditing(undefined)
        }}
        onClose={() => setEditing(undefined)}
      />
    </div>
  )
}

function Group({
  title,
  description,
  icon,
  rows,
  onCustomize,
}: {
  title: string
  description: string
  icon: React.ReactNode
  rows: readonly AdminTemplateValue[]
  onCustomize: (key: string) => void
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        {/* `h3`: the page renders the `h2` and the settings layout owns the `h1`. */}
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      </div>

      {rows.map((row) => (
        <Card key={row.key}>
          <CardContent className="flex flex-wrap items-start gap-3">
            {icon}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {row.title}
                {/* "Customized" means a stored row with a body, which is what makes it the
                    email that actually goes out. Without it there is nothing on screen that
                    distinguishes an edited template from a built-in one. */}
                {row.customized ? <Badge variant="secondary">Customized</Badge> : null}
              </p>
              <p className="text-sm text-pretty text-muted-foreground">{row.description}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                Subject: {row.subject === '' ? row.defaultSubject : row.subject}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="hit-area-y"
              onClick={() => onCustomize(row.key)}
            >
              Customize
            </Button>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
