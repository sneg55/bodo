'use client'

// Ref 34's `+ Add Dashboard`, and the New Dashboard modal it opens (ref 40).
//
// `Dialog`, because ref 40 is a centred modal over the dashboard. The mode tabs are `Tabs` with
// two panes: the gallery grid and the AI description box.
//
// Choosing a card writes and then navigates to the new tab, rather than closing the modal and
// leaving the organizer to find it in the strip. The href comes back from the action, which
// computes it from the same pure function the strip renders from, so the URL and the tab cannot
// disagree.
//
// **Ref 40's third tab, `Build manually`, is gone.** It was a tab whose pane said the mode is not
// built, which is a control that costs a click to learn nothing, and an empty-dashboard builder is
// a whole uncaptured flow rather than the interior of a captured control, so SPEC.md line 55's
// exception does not reach it. `AI prompt` DOES fall under that exception and is built: ref 40
// captures the tab, its label and its sparkle icon, so only the inside was authored.
//
// The AI pane is two clicks on purpose. Propose renders a preview built from the SAME
// `TemplateThumbnail` the gallery cards use, so a proposed dashboard is previewed the way a
// template is; Create is separate, so a widget can be dropped before any row exists.

import { LayoutGridIcon, PlusIcon, SparklesIcon, XIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { createDashboardFromTemplateAction } from '@/features/dashboard/actions'
import {
  createDashboardFromProposalAction,
  proposeDashboardAction,
} from '@/features/dashboard/ai-actions'
import type { DashboardProposal } from '@/features/dashboard/ai-proposal'
import { DashboardDot } from '@/features/dashboard/DashboardDot'
import {
  DASHBOARD_MODES,
  type DashboardMode,
  DEFAULT_DASHBOARD_MODE,
  NEW_DASHBOARD_SUBTITLE,
} from '@/features/dashboard/dashboard-modes'
import { DASHBOARD_TEMPLATES } from '@/features/dashboard/dashboard-templates'
import { TemplateThumbnail } from '@/features/dashboard/TemplateThumbnail'
import { widgetSpec } from '@/features/dashboard/widget-catalog'

/** Authored. The pane has no captured copy of its own; ref 40 shows the tab and nothing behind it. */
const AI_PLACEHOLDER = 'Show me how speakers are doing: who has confirmed, and what is overdue.'

const MODE_ICONS = new Map<DashboardMode, typeof LayoutGridIcon>([
  ['gallery', LayoutGridIcon],
  ['ai', SparklesIcon],
])

export function NewDashboardButton({ eventId }: { eventId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<DashboardMode>(DEFAULT_DASHBOARD_MODE)
  const [pending, startTransition] = useTransition()
  const [described, setDescribed] = useState('')
  const [proposal, setProposal] = useState<DashboardProposal | undefined>(undefined)
  /** `AI_SAMPLE_NOTICE` when the proposal was canned. Comes back with it: see ai-actions.ts. */
  const [notice, setNotice] = useState<string | undefined>(undefined)

  const instantiate = (templateKey: string) => {
    startTransition(async () => {
      const result = await createDashboardFromTemplateAction(eventId, templateKey)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setOpen(false)
      if (result.href !== undefined) router.push(result.href)
    })
  }

  const propose = () => {
    startTransition(async () => {
      const result = await proposeDashboardAction(eventId, described)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setProposal(result.proposal)
      setNotice(result.notice)
    })
  }

  const create = (accepted: DashboardProposal) => {
    startTransition(async () => {
      const result = await createDashboardFromProposalAction(eventId, accepted)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setOpen(false)
      if (result.href !== undefined) router.push(result.href)
    })
  }

  /**
   * Closing throws the proposal away.
   *
   * Reopening onto a previous answer would be a modal that looks like it has already done the
   * work, and the description that produced it is the one thing an organizer would have to
   * re-read to know what it was.
   */
  const change = (next: boolean) => {
    setOpen(next)
    if (next) return
    setDescribed('')
    setProposal(undefined)
    setNotice(undefined)
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="hit-area-y" />}>
        {/* `data-icon="inline-start"` trips the Button's own optical padding
            (`has-data-[icon=inline-start]:pl-1.5` against a base `px-2.5`), so the leading
            icon sits closer to the edge than the trailing text and the label reads centred. */}
        <PlusIcon data-icon="inline-start" />
        Add Dashboard
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New Dashboard</DialogTitle>
          <DialogDescription>{NEW_DASHBOARD_SUBTITLE}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(next: string) => {
            const match = DASHBOARD_MODES.find((candidate) => candidate.id === next)
            if (match !== undefined) setMode(match.id)
          }}
        >
          <TabsList>
            {DASHBOARD_MODES.map((candidate) => {
              const Icon = MODE_ICONS.get(candidate.id) ?? LayoutGridIcon
              return (
                <TabsTrigger key={candidate.id} value={candidate.id}>
                  <Icon data-icon="inline-start" />
                  {candidate.label}
                </TabsTrigger>
              )
            })}
          </TabsList>

          <TabsContent value="gallery" className="pt-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {DASHBOARD_TEMPLATES.map((template) => (
                <Button
                  key={template.key}
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    instantiate(template.key)
                  }}
                  // `plain-label`: the card's body is a saved template's name and a sentence
                  // describing it, not a command. The machine-label treatment set both in 11px
                  // mono uppercase, which turned the description into a shout and the title
                  // into something no one wrote.
                  className="plain-label h-auto flex-col items-stretch gap-2 whitespace-normal p-3 text-left"
                >
                  <TemplateThumbnail metrics={template.metrics} />
                  <span className="text-sm font-medium text-balance">{template.title}</span>
                  <span className="line-clamp-2 text-xs font-normal text-pretty text-muted-foreground">
                    {template.description}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">{template.category}</Badge>
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">
                      {widgetCount(template.metrics.length)}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="ai" className="grid gap-3 pt-3">
            <div className="grid gap-2">
              <Label htmlFor="ai-dashboard-description">Describe the dashboard you want</Label>
              <Textarea
                id="ai-dashboard-description"
                rows={3}
                placeholder={AI_PLACEHOLDER}
                value={described}
                disabled={pending}
                onChange={(event) => {
                  setDescribed(event.target.value)
                }}
              />
            </div>

            <div className="flex justify-end">
              <Button
                size="sm"
                // A description is what there is to propose from, so an empty box has nothing to
                // send. The action refuses it too: this only saves the round trip.
                disabled={pending || described.trim() === ''}
                onClick={propose}
              >
                <SparklesIcon data-icon="inline-start" />
                Propose
              </Button>
            </div>

            {notice === undefined ? null : (
              <Alert>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}

            {proposal === undefined ? null : (
              <div className="grid gap-3 rounded-lg border border-border p-3">
                <TemplateThumbnail metrics={proposal.metrics} />
                <div className="grid gap-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <DashboardDot color={proposal.color} />
                    {proposal.name}
                  </span>
                  {proposal.description === '' ? null : (
                    <span className="text-xs text-muted-foreground">{proposal.description}</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {proposal.metrics.map((metric) => (
                    <Badge key={metric} variant="secondary" className="gap-1 pr-1">
                      {widgetSpec(metric).title}
                      <Button
                        variant="ghost"
                        size="icon"
                        // 16px is half a comfortable target. The chips wrap in a `gap-1.5`
                        // row of `h-5` badges, so the vertical pitch between one chip row and
                        // the next is 20 + 6 = 26px: a 40px area would cross into the row
                        // above and below, and 26px is the largest that cannot.
                        className="size-4 hit-area-[26px]"
                        // The reason Create is a second click: a widget can be dropped while the
                        // proposal is still only a proposal.
                        aria-label={`Remove ${widgetSpec(metric).title}`}
                        disabled={pending}
                        onClick={() => {
                          setProposal({
                            ...proposal,
                            metrics: proposal.metrics.filter((kept) => kept !== metric),
                          })
                        }}
                      >
                        <XIcon />
                      </Button>
                    </Badge>
                  ))}
                </div>

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    // Removing every chip leaves nothing to create, and the action refuses an
                    // empty widget list rather than making an empty dashboard.
                    disabled={pending || proposal.metrics.length === 0}
                    onClick={() => {
                      create(proposal)
                    }}
                  >
                    Create dashboard
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

/** Ref 40's card footer reads "5 widgets"; one widget is not "1 widgets". */
function widgetCount(count: number): string {
  return count === 1 ? '1 widget' : `${count} widgets`
}
