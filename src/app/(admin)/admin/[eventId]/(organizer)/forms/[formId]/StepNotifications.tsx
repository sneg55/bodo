'use client'

// Step 7, Notifications (parity ref 15).
//
// The two admin recipient fields are the screenshot's multi-select with removable chips, over
// the event's own team (`MemberPicker`). `Forms.adminAlertOnNew` and `adminAlertOnUpdate` store
// email ADDRESSES rather than member record links, so the team is the source of suggestions and
// never the set of legal values: a free-typed alias and a member whose membership was later
// revoked both stay in the control, as a visibly different chip. Every rule behind that is in
// `@/features/team/recipients` and unit tested there.
//
// The two panels below are their own files, and not only for the 300-line limit: they answer
// to different tables and different saves, which is the one thing about this step that is
// easy to get wrong.
//
//   - "Submitter notifications" is FORM state. The toggle and the body are
//     `Forms.confirmationEmailEnabled` and `confirmationEmailHtml`, they live on this draft,
//     and the editor's Save writes them. Its `Customize` drawer therefore has no Save.
//   - "Admin notifications" is EVENT state, in `EmailTemplates`, keyed `custom-admin-new` and
//     `custom-admin-update`. It is not part of this draft and saves through its own
//     authorized action, so it takes no props from here at all.
//
// Both are wired to senders. The confirmation body is what the CFP submit's confirmation email
// carries, and the two admin templates are what `submission.admin_new` and
// `submission.admin_update` send, preferring the stored row over the built-in body
// (@/features/comms/resolve-template).

import { toast } from 'sonner'

import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { MemberPicker } from '@/features/team/MemberPicker'
import type { RecipientOption } from '@/features/team/recipients'

import { AdminNotificationsPanel } from './AdminNotificationsPanel'
import type { StepProps } from './EditorStepBody'
import { SubmitterNotificationsPanel } from './SubmitterNotificationsPanel'

export type StepNotificationsProps = StepProps & {
  recipients: readonly RecipientOption[]
}

export function StepNotifications({ draft, patch, recipients }: StepNotificationsProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Choose who receives admin alerts and customize automated emails for this form.
      </p>

      <Card className="gap-3 px-4 py-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alert-new">
            What admins should be notified when a new submission is received?
          </Label>
          <MemberPicker
            id="alert-new"
            members={recipients}
            value={draft.adminAlertOnNew}
            placeholder="Select team members..."
            onChange={(emails) => patch({ adminAlertOnNew: emails })}
            // A refused address is reported rather than dropped: an alert recipient that was
            // silently ignored is discovered when the alert does not arrive.
            onError={(message) => toast.error(message)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="alert-update">
            What admins should be notified when an existing submission is updated?
          </Label>
          <MemberPicker
            id="alert-update"
            members={recipients}
            value={draft.adminAlertOnUpdate}
            placeholder="Select team members..."
            onChange={(emails) => patch({ adminAlertOnUpdate: emails })}
            onError={(message) => toast.error(message)}
          />
        </div>
      </Card>

      <SubmitterNotificationsPanel
        enabled={draft.confirmationEmailEnabled}
        html={draft.confirmationEmailHtml}
        onEnabledChange={(checked) => patch({ confirmationEmailEnabled: checked })}
        onHtmlChange={(html) => patch({ confirmationEmailHtml: html })}
      />

      <AdminNotificationsPanel />
    </div>
  )
}
