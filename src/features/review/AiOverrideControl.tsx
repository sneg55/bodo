'use client'

// The chair's override of an AI pre-screen score. ABS-14.
//
// The pre-screen already produced a first-pass number with specific written reasoning, and
// the surface already promised that "AI reviews are labelled and stay out of the human
// average". What no surface had was the other half of the rubric item: an organizer who
// disagrees with the machine could not say so anywhere. An accessibility dump of the whole
// submission detail listed ACCEPT QUEUE, DECLINE QUEUE, PREVIEW EMAIL, NOTIFY, EDIT STATUS,
// VERSION HISTORY, EDIT and ADD PARTICIPANT: every one of them acts on the SUBMISSION, and
// none of them on the review.
//
// A `Dialog` rather than an inline field, because the override is three related answers
// (score, verdict, why) and half of one is not a state worth persisting. The write goes to
// the AI's own review row, so it survives a reload; `ai-override.ts` holds where and why.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { REVIEW_RECOMMENDATIONS } from '@/constants/status'
import type { AiOverride } from '@/features/review/ai-override'
import { clearAiOverrideAction, setAiOverrideAction } from '@/features/review/ai-override-actions'
import { recommendationLabel } from '@/features/review/review-draft'

/** The Select's "no verdict of my own" option. Empty is not a value a Select may hold. */
const KEEP = 'keep'

/**
 * Value-to-label for the closed trigger. Base UI prints the raw VALUE there unless the
 * Select is given its items, so without this the trigger read `maybe` under a menu that
 * says `Maybe`.
 */
const RECOMMENDATION_ITEMS = [
  { value: KEEP, label: "Leave the AI's recommendation" },
  ...REVIEW_RECOMMENDATIONS.map((value) => ({ value, label: recommendationLabel(value) })),
]

export function AiOverrideControl({
  eventId,
  submissionId,
  roundId,
  override,
  aiPercent,
}: {
  eventId: string
  submissionId: string
  roundId: string
  /** The override already on the row, when there is one. */
  override?: AiOverride
  /** What the AI itself scored, so the box opens on a number to argue with. */
  aiPercent?: number
}) {
  const [open, setOpen] = useState(false)
  const [percent, setPercent] = useState(String(override?.percent ?? aiPercent ?? ''))
  const [recommendation, setRecommendation] = useState<string>(override?.recommendation ?? KEEP)
  const [note, setNote] = useState(override?.note ?? '')
  const [pending, startTransition] = useTransition()

  const save = () => {
    startTransition(async () => {
      const result = await setAiOverrideAction({
        eventId,
        submissionId,
        roundId,
        percent,
        recommendation: recommendation === KEEP ? undefined : recommendation,
        note,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // No `router.refresh()`: the action wrote through `invalidate()`, which expires the
      // tags this page reads, and Next re-renders the route as part of the action's own
      // response. A refresh on top is the wasted round trip BUILD_SPEC 6.1 warns about.
      toast.success('Saved successfully')
      setOpen(false)
    })
  }

  const clear = () => {
    startTransition(async () => {
      const result = await clearAiOverrideAction({ eventId, submissionId, roundId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Override removed')
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            // 28px tall at the end of a row of badges, none of which is a target of its own,
            // and the next review's header is a separator and 16px away.
            className="hit-area-y"
          >
            {override === undefined ? 'Override score' : 'Edit override'}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override the AI score</DialogTitle>
          <DialogDescription>
            Your score is recorded on this pre-screen review and shown beside the AI&apos;s, which
            is left exactly as the model wrote it. Like the AI&apos;s own score, an override stays
            out of the committee average.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ai-override-percent">Your score</Label>
            <Input
              id="ai-override-percent"
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              className="w-32"
              value={percent}
              onChange={(event) => {
                setPercent(event.target.value)
              }}
            />
            <p className="text-sm text-muted-foreground">
              A percentage, 0 to 100.
              {aiPercent === undefined ? '' : ` The AI scored this ${String(aiPercent)}%.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ai-override-recommendation">Your recommendation</Label>
            <Select
              value={recommendation}
              items={RECOMMENDATION_ITEMS}
              onValueChange={(next: string | null) => {
                if (next !== null) setRecommendation(next)
              }}
            >
              <SelectTrigger id="ai-override-recommendation" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECOMMENDATION_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ai-override-note">Why</Label>
            <Textarea
              id="ai-override-note"
              rows={3}
              value={note}
              placeholder="What the pre-screen got wrong."
              onChange={(event) => {
                setNote(event.target.value)
              }}
            />
          </div>
        </div>

        <DialogFooter>
          {override === undefined ? null : (
            <Button variant="ghost" disabled={pending} onClick={clear}>
              Remove override
            </Button>
          )}
          <Button disabled={pending} onClick={save}>
            Save override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
