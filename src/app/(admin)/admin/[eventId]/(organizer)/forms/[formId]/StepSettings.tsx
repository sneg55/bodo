'use client'

// Step 6, Form Settings (parity refs 13-14): deadlines, capacity, and what a submitter sees
// after submitting.
//
// Every control here is one the public wizard already reads: `closeDate` gates the form
// server-side and prints the deadline banner, the limit is counted on submit,
// `allowMultipleDrafts` governs the portal, `successHtml` is the confirmation page and
// `autoRedirectToPortal` is its ten-second redirect. Nothing is decorative.
//
// "Cross-field character limits" is the last card, in its own module: the wizard already
// enforced `crossFieldLimitsJson` and applied it per participant, so what shipped here is the
// authoring half rather than the feature.

import { DateTimeField } from '@/components/primitives/DateTimeField'
import { RichTextEditor } from '@/components/primitives/RichTextEditor'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { dateKeyAt, minutesAt, zonedDateTimeToIso } from '@/features/agenda/time'

import { CrossFieldLimitsCard } from './CrossFieldLimitsCard'
import type { StepProps } from './EditorStepBody'

export function StepSettings({ draft, patch, eventTimeZone }: StepProps) {
  const closeDateIso = localInputToIso(draft.closeDate, eventTimeZone)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Configure submission deadlines, limits, and post-submission behavior.
      </p>

      <Card className="gap-2 px-4 py-3">
        <h3 className="text-sm font-semibold">Close Date</h3>
        <p className="text-xs text-muted-foreground">
          If set, form and submissions will close after specified date.
        </p>
        {/* `DateTimeField`, not `Input type="datetime-local"`, and the reason is the same one
            that put every other date-time control in the app on this primitive: the native
            control's year segment takes six digits, so a mistyped deadline in the year 202600
            is accepted silently and the form never closes. The picker also prints the zone the
            deadline is actually enforced in, which a bare `datetime-local` cannot: it shows a
            wall clock with no zone at all next to a value the server reads in the event's. */}
        <div className="w-full sm:w-96">
          <DateTimeField
            id="close-date"
            value={closeDateIso}
            timeZone={eventTimeZone}
            onChange={(iso) => patch({ closeDate: isoToLocalInput(iso, eventTimeZone) })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Set a close date to enable draft reminder emails.
        </p>
      </Card>

      <Card className="gap-3 px-4 py-3">
        <h3 className="text-sm font-semibold">Submission capacity</h3>
        <p className="text-xs text-muted-foreground">
          How many sessions each submitter may have, and how saved drafts work on the portal.
        </p>

        <div className="flex items-start gap-3">
          <span className="flex min-w-0 flex-col">
            <Label htmlFor="limit-enabled">Set Submission Limit</Label>
            <span className="text-xs text-muted-foreground">
              Limit how many sessions one user may have for this form. Includes saved drafts and
              submitted sessions.
            </span>
          </span>
          <Switch
            id="limit-enabled"
            className="ml-auto"
            checked={draft.submissionLimitEnabled}
            onCheckedChange={(checked) => patch({ submissionLimitEnabled: checked })}
          />
        </div>

        {draft.submissionLimitEnabled ? (
          <Input
            type="number"
            min={1}
            className="w-full sm:w-40"
            aria-label="Submission limit"
            value={draft.submissionLimit}
            onChange={(event) => patch({ submissionLimit: event.target.value })}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            The event-level maximum applies when no form-level limit is set.
          </p>
        )}

        <div className="flex items-start gap-3">
          <span className="flex min-w-0 flex-col">
            <Label htmlFor="multiple-drafts">Allow multiple draft submissions</Label>
            <span className="text-xs text-muted-foreground">
              Lets one submitter keep more than one unfinished submission on the portal.
            </span>
          </span>
          <Switch
            id="multiple-drafts"
            className="ml-auto"
            checked={draft.allowMultipleDrafts}
            onCheckedChange={(checked) => patch({ allowMultipleDrafts: checked })}
          />
        </div>
      </Card>

      <Card className="gap-3 px-4 py-3">
        <h3 className="text-sm font-semibold">After submission</h3>
        <p className="text-xs text-muted-foreground">
          What submitters see on the confirmation page after they complete the form.
        </p>

        <div className="flex items-start gap-3">
          <span className="flex min-w-0 flex-col">
            <Label htmlFor="auto-redirect">Auto-redirect to speaker portal</Label>
            <span className="text-xs text-muted-foreground">
              After 10 seconds on the confirmation page. If off, submitters use Continue to portal.
            </span>
          </span>
          <Switch
            id="auto-redirect"
            className="ml-auto"
            checked={draft.autoRedirectToPortal}
            onCheckedChange={(checked) => patch({ autoRedirectToPortal: checked })}
          />
        </div>

        <RichTextEditor
          id="success-html"
          label="Customize the success page message:"
          value={draft.successHtml}
          help="Shown on the public confirmation page after submit (and after payment, when fees apply)."
          onChange={(html) => patch({ successHtml: html })}
        />
      </Card>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Validation rules</h3>
        <p className="text-xs text-muted-foreground">
          Combined character limits across several text fields.
        </p>
      </div>
      <CrossFieldLimitsCard draft={draft} patch={patch} />
    </div>
  )
}

/**
 * The two halves of the adapter between what the DRAFT stores and what the CONTROL takes.
 *
 * `draft.closeDate` is `datetime-local` text carrying a wall clock and no zone, and
 * `DateTimeField` works in ISO instants, so something has to say which wall clock that text
 * is. It is the event's, because that is the zone `draft.ts` already reads and writes it in
 * on both the load and the save path (`toLocalInput` / `toIsoOrUndefined`).
 *
 * These live here rather than in `draft.ts` on purpose. The stored shape is unchanged, the
 * two functions there are still the ones the save path uses, and this is the presentation
 * concern of one control. They are the same three calls from `@/features/agenda/time` that
 * those private helpers make, so a round trip through this pair is lossless to the minute,
 * which is the precision the control offers.
 */
function localInputToIso(local: string, timeZone: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/u.exec(local.trim())
  if (match === null) return undefined
  const [, dateKey = '', hour = '0', minute = '0'] = match
  return zonedDateTimeToIso(dateKey, Number(hour) * 60 + Number(minute), timeZone)
}

function isoToLocalInput(iso: string | undefined, timeZone: string): string {
  // Undefined is the X button, and the draft spells "no deadline" as the empty string.
  if (iso === undefined) return ''
  const dateKey = dateKeyAt(iso, timeZone)
  const minutes = minutesAt(iso, timeZone)
  if (dateKey === undefined || minutes === undefined) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${dateKey}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}
