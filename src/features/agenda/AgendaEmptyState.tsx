import { CalendarDaysIcon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'

/**
 * The copy defaults are the admin list view's, verbatim from docs/parity/agenda.md, so
 * the admin call site passes nothing. The public agenda overrides the body, because
 * "in list view" names a view a visitor cannot see.
 */
export function AgendaEmptyState({
  title = 'Nothing here yet',
  description = 'Sessions will appear here in list view',
}: {
  title?: string
  description?: string
} = {}) {
  return (
    <Card className="min-h-80 justify-center">
      <CardContent className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CalendarDaysIcon className="size-5" />
        </div>
        <div className="space-y-1">
          <h2 className="font-heading text-base font-medium">{title}</h2>
          <p className="text-pretty text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}
