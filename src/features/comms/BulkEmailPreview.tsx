'use client'

// What the composer's Preview button renders: the merge-field report, then the first few
// messages exactly as they would be sent. SPK-13.
//
// The messages come back from `previewBulkEmailAction`, which built them with the SAME
// `bulkEmailRows` the send uses, so this is not a rendering of the draft, it is a rendering of
// the record that would be queued. That distinction is the point of the control: a preview
// assembled from the draft on the client could be right while the mail is wrong, which is
// worse than showing nothing.
//
// The merge report comes FIRST and suppresses the messages when it is non-empty, because a
// draft naming a field some recipients cannot supply has nothing to preview: the render would
// have thrown. Naming the field and the number of people it affects turns
// `MAIL_MERGE_FIELD_UNKNOWN` into a sentence to reword.

import { OrganizerHtml } from '@/components/primitives/OrganizerHtml'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BulkPreviewResult } from '@/features/comms/bulk-actions'

function problemLine(problem: BulkPreviewResult['problems'][number]): string {
  const who =
    problem.missingFor === 1
      ? '1 selected speaker'
      : `${String(problem.missingFor)} selected speakers`
  return problem.known
    ? `{{${problem.field}}} is blank for ${who}`
    : `{{${problem.field}}} is not a merge field this email can use`
}

/**
 * The report arrives as one block when Preview is pressed, and it can be tall: a row of
 * counts plus several fully rendered messages. Animating the section as a single container
 * slides a wall of content past the reader, so it is split into the two chunks it already
 * is, and the counts land 100ms ahead of the messages they describe.
 *
 * `fill-mode-backwards` is not optional beside a delay. Without it the late chunk paints at
 * full opacity for its 100ms wait and only then snaps back to the animation's first frame,
 * which is a flash rather than a stagger. Same idiom, same easing, as `PALETTE_GROUP_ENTER`
 * in the global search palette and `STEP_ENTER` in the wizard.
 */
const PREVIEW_ENTER =
  'animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-[cubic-bezier(0.2,0,0,1)]'
const PREVIEW_ENTER_LATE = `${PREVIEW_ENTER} delay-100 fill-mode-backwards`

export function BulkEmailPreview({ preview }: { preview: BulkPreviewResult }) {
  return (
    <section className="flex flex-col gap-3">
      <div className={`flex flex-wrap items-center gap-2 ${PREVIEW_ENTER}`}>
        <h3 className="text-sm font-semibold">Preview</h3>
        <Badge variant="secondary">
          {preview.recipients} {preview.recipients === 1 ? 'recipient' : 'recipients'}
        </Badge>
        {preview.skippedNoEmail === 0 ? null : (
          <Badge variant="outline">{preview.skippedNoEmail} with no email address</Badge>
        )}
        {preview.skippedDuplicate === 0 ? null : (
          <Badge variant="outline">{preview.skippedDuplicate} duplicate addresses</Badge>
        )}
        {/* Only ever non-zero from the cross-event directory, and the one exclusion an
            organizer can act on: send again under the event those people are on. */}
        {preview.notOnEvent === 0 ? null : (
          <Badge variant="destructive">{preview.notOnEvent} not on this event</Badge>
        )}
      </div>

      {preview.problems.length > 0 ? (
        <Alert variant="destructive" className={PREVIEW_ENTER_LATE}>
          <AlertTitle>Some merge fields will not resolve</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {preview.problems.map((problem) => (
                <li key={problem.field}>{problemLine(problem)}</li>
              ))}
            </ul>
            <p>Reword those lines, or remove the field, then preview again.</p>
          </AlertDescription>
        </Alert>
      ) : (
        preview.messages.map((message) => (
          <Card key={message.toEmail} className={PREVIEW_ENTER_LATE}>
            <CardHeader>
              <CardTitle className="text-sm text-pretty">{message.subject}</CardTitle>
              <p className="text-xs text-pretty text-muted-foreground">
                To {message.name} at {message.toEmail}
              </p>
            </CardHeader>
            <CardContent>
              {/* The organizer's OWN draft, merged and rendered back to them in their own
                  session. `OrganizerHtml` is the shared sink for authored markup; the value
                  here has not been through the DAL's sanitizer because it was never stored,
                  and the untrusted half of it (every merged speaker value) was escaped by
                  `renderTemplate` on the way in. */}
              <OrganizerHtml html={message.html} />
            </CardContent>
          </Card>
        ))
      )}
    </section>
  )
}
