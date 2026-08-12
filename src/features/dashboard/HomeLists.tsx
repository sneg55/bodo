// "Your forms" and "Recent Submissions" from ref 35.
//
// The aggregate progress bar and the per-form bars are `Progress`, not a chart: they are a
// ratio of two counts. SPEC.md line 44 defers charts, and a bar of one number is not one.

import { ExternalLinkIcon, SettingsIcon } from 'lucide-react'
import Link from 'next/link'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { StatusChip } from '@/components/primitives/StatusChip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { FormProgress } from '@/features/dashboard/home-view'
import type { FormPublicState } from '@/types/forms'

const STATE_LABEL: Record<FormPublicState, string> = {
  open: 'Open',
  closed: 'Closed',
  draft: 'Draft',
}

export type RecentRow = {
  id: string
  code: string
  title: string
  status: Parameters<typeof StatusChip>[0]['status']
  sourceName?: string
  speakers: readonly string[]
  tags: readonly string[]
  submittedLabel: string
}

export function YourForms({
  forms,
  submitted,
  receiving,
  editHref,
  previewHref,
  visible = 3,
}: {
  forms: readonly FormProgress[]
  submitted: number
  /** How many forms have received at least one submission: the aggregate bar's numerator. */
  receiving: number
  editHref: (formId: string) => string
  previewHref: (form: FormProgress) => string | undefined
  visible?: number
}) {
  if (forms.length === 0) return null
  const shown = forms.slice(0, visible)
  const hidden = forms.length - shown.length
  const most = Math.max(...forms.map((form) => form.submitted), 1)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-medium">Your forms</h2>
        {hidden > 0 ? (
          <span className="text-sm text-muted-foreground tabular-nums">{`View ${hidden} more`}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground">
          SUBMISSION PROGRESS
        </p>
        {/* Forms that have received something, over all forms. No form carries a quota, so
            a bar over a submission count would need a denominator nobody has; this one is a
            real ratio. The caption below is the captured count, which is a different fact
            and is why both are shown. */}
        <Progress value={(receiving / forms.length) * 100} />
        {/* The caption under a bar that moves with every submission, so proportional digits
            reflow the word beside them each time it recounts. */}
        <p className="text-xs text-muted-foreground tabular-nums">{`${submitted} submitted`}</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {shown.map((form) => (
          <Card key={form.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle className="text-sm">{form.name}</CardTitle>
                <Badge variant={form.state === 'open' ? 'default' : 'secondary'}>
                  {STATE_LABEL[form.state]}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {form.closesLabel === undefined ? null : (
                <p className="text-xs text-muted-foreground">{form.closesLabel}</p>
              )}
              <Progress value={most === 0 ? 0 : (form.submitted / most) * 100} />
              <p className="text-xs text-muted-foreground tabular-nums">
                {form.submitted === 0 ? 'No submissions yet' : `${form.submitted} submitted`}
              </p>
              <div className="flex flex-wrap gap-2">
                {previewHref(form) === undefined ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    // 28px tall, already ~60px wide, and its only neighbour is Manage across
                    // an 8px gap. `hit-area-y` grows the height alone, so the gap stays a gap.
                    className="hit-area-y"
                    nativeButton={false}
                    render={
                      <Link href={previewHref(form) ?? '#'} target="_blank" rel="noreferrer" />
                    }
                  >
                    {/* `data-icon="inline-start"` trips the Button's own optical padding
                        (`has-data-[icon=inline-start]:pl-1.5` against a base `px-2.5`), so the
                        leading icon sits closer to the edge and the label reads centred. */}
                    <ExternalLinkIcon data-icon="inline-start" />
                    View
                  </Button>
                )}
                <ButtonLink
                  href={editHref(form.id)}
                  size="sm"
                  variant="outline"
                  className="hit-area-y"
                >
                  <SettingsIcon data-icon="inline-start" />
                  Manage
                </ButtonLink>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

export function RecentSubmissionsTable({
  rows,
  viewAllHref,
}: {
  rows: readonly RecentRow[]
  viewAllHref: string
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-medium">Recent Submissions</h2>
        <Link
          href={viewAllHref}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          View all
        </Link>
      </div>

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Speakers</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    No submissions yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-40 truncate">
                    {row.sourceName === undefined ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      <Badge variant="secondary">{row.sourceName}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-64 truncate">
                    <span className="text-xs text-muted-foreground">{`${row.code} `}</span>
                    {row.title}
                  </TableCell>
                  <TableCell>
                    <StatusChip status={row.status} withIcon />
                  </TableCell>
                  <TableCell className="max-w-48 truncate">
                    {row.speakers.length === 0 ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      row.speakers.join(', ')
                    )}
                  </TableCell>
                  <TableCell className="max-w-48">
                    {row.tags.length === 0 ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {row.tags.map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {row.submittedLabel}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  )
}
