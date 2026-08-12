// /portal/submissions/[code]: everything BUILD_SPEC 5.2 lists for the detail page.
//
// Title and code, the status badge, the session-type subtitle, the participant roster
// with roles and a Primary marker, the submitted answers in the form's own field order,
// the attached files, and the submission-scoped tasks under the same `Submission Tasks`
// heading the home card uses.
//
// The answers section is the one part that changes shape: 5.2's first two edit modes render
// it as a form (`SubmissionBodyForm`) and the frozen mode renders it as text, because that
// section asks for read-only rather than disabled. Same heading either way, since it is the
// same content.
//
// It takes the code as a plain string. It used to take the unawaited `params` promise and
// await it here, because a `page.tsx` body that awaited params was unprerenderable under
// `cacheComponents`; the page resolves the route's params itself now. This component stays
// separate from the page so the page can keep it inside `<Suspense>`: the reads below are
// several Airtable calls, and the portal frame around them is not.
//
// A submission that is not the caller's is `notFound()`, the same as one that does not
// exist. `readOwnSubmissionByCode` filters to the caller's own list before looking the code
// up, so telling the two apart is not possible and that is intended. That call and the
// `notFound()` now live in the page body rather than here: see the note on the props below.

import { StatusChip } from '@/components/primitives/StatusChip'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { submittedAnswers } from '@/features/portal/answers-view'
import { EditModeNotice } from '@/features/portal/EditModeNotice'
import type { OwnSubmissionDetail } from '@/features/portal/reads'
import { buildRoster } from '@/features/portal/roster'
import { assignableRoles, rosterEditable } from '@/features/portal/roster-rules'
import { SubmissionActions } from '@/features/portal/SubmissionActions'
import { SubmissionAnswers } from '@/features/portal/SubmissionAnswers'
import { SubmissionBodyForm } from '@/features/portal/SubmissionBodyForm'
import { SubmissionFiles } from '@/features/portal/SubmissionFiles'
import { SubmissionRoster } from '@/features/portal/SubmissionRoster'
import { SubmissionTasks } from '@/features/portal/SubmissionTasks'
import { formatOptions, sessionTypeLabel } from '@/features/portal/session-type'
import { answersForForm } from '@/features/portal/submission-columns'
import { bodyEditPermission } from '@/features/portal/submission-edit'
import { submissionFileViews } from '@/features/portal/submission-files'
import { tasksForSubmission } from '@/features/portal/task-groups'
import { toTaskViews } from '@/features/portal/task-view'
import { dateTimeText } from '@/features/review/date-text'
import { listTags, listTracks } from '@/services/airtable/queries'
import { publicUrlFor } from '@/services/storage/uploads'

/**
 * Takes the already-resolved submission, not the code.
 *
 * It used to do the lookup itself and call `notFound()` here, and that is why a bogus code
 * answered HTTP 200 with the 404 page: this component renders inside the page's
 * `<Suspense>`, so by the time it throws the shell has flushed and the status is already
 * sent. Resolving in the page body is what makes the status right, and it is the same
 * reason the conventions file forbids `redirect()` from inside a boundary. Verified on the
 * deployed Worker, where the sibling resources route went 200 to 404 on exactly this move.
 *
 * The boundary still earns its keep: the tracks and tags reads below stay behind it.
 */
export type SubmissionDetailProps = { detail: OwnSubmissionDetail }

export async function SubmissionDetail({ detail }: SubmissionDetailProps) {
  const { submission, form, event, files, tasks, speakerId } = detail
  // The SUBMISSION'S event, not the configured one. Tracks and tags are per event, so a
  // submission to any conference other than `PORTAL_EVENT_ID` resolved its chips against
  // the wrong vocabulary and rendered raw record ids.
  const eventId = event.id
  const [tracks, tags] = await Promise.all([listTracks(eventId), listTags(eventId)])

  // The same derivation the save re-runs (`bodyEditPermission`), so the page and the
  // mutation cannot disagree about whether this body is editable. The page's answer is not
  // what authorizes anything: the action recomputes it from the record it loads itself.
  const permission = bodyEditPermission({ status: submission.status, form, now: new Date() })

  const names = new Map([...tracks, ...tags].map((row) => [row.id, row.name]))
  const sessionType = sessionTypeLabel(submission, formatOptions(form))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{submission.code}</p>
              {/* `text-balance`: the global rule that balances headings targets h1-h3, and
                  `CardTitle` is a div, so a two-line session title wrapped with one word on
                  the second line. Session titles are the longest user text on this page. */}
              <CardTitle className="text-lg text-balance">{submission.title}</CardTitle>
              {sessionType === undefined ? null : (
                <p className="text-sm text-muted-foreground">{sessionType}</p>
              )}
            </div>
            <StatusChip status={submission.status} withIcon />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <EditModeNotice permission={permission} />
          <SubmissionActions
            code={submission.code}
            canSubmit={permission.mode === 'full'}
            canWithdraw={permission.bodyEditable}
          />
        </CardContent>
      </Card>

      <Section title="Participants">
        {/* `canEdit` off the SAME permission that decides whether the answers below are a
            form or text, because the cast is part of the submission's content: a body that
            is frozen has a frozen roster. Presentation only, as with `SubmissionActions`
            above it: `addParticipant` and `removeParticipant` re-derive this from the
            record they load themselves. */}
        <SubmissionRoster
          roster={buildRoster(submission, speakerId)}
          edit={
            rosterEditable(permission)
              ? { code: submission.code, roles: assignableRoles(form?.roles ?? []) }
              : undefined
          }
        />
      </Section>

      <Section title="Submitted answers">
        {/* One heading for both modes, because it is the same content either way. The
            answers become controls when the mode allows it and stay text when it does not. */}
        {permission.bodyEditable && form !== undefined && form.fields.length > 0 ? (
          <SubmissionBodyForm
            code={submission.code}
            fields={form.fields}
            answers={answersForForm(form.fields, submission)}
          />
        ) : (
          <SubmissionAnswers
            rows={submittedAnswers({
              submission,
              form,
              lookups: { nameOf: (id) => names.get(id) },
            })}
          />
        )}
      </Section>

      <Section title="Files">
        {/* The version list, built by the same `fileVersions` the organizer's PROGRAM > Files
            table uses, so the two sides cannot disagree about which upload is current. The
            timestamp carries the TIME, because two uploads of a corrected deck on one
            afternoon are the case this exists for and a date alone cannot order them. */}
        <SubmissionFiles
          files={submissionFileViews(files, {
            formatDateTime: (iso) => dateTimeText(iso, event.timezone),
            publicUrl: safePublicUrl,
            submissionCode: submission.code,
          })}
        />
      </Section>

      <Card>
        <CardContent className="pt-6">
          <SubmissionTasks
            tasks={toTaskViews({
              items: tasksForSubmission(tasks, submission.id),
              submissions: [submission],
              forms: form === undefined ? [] : [form],
              timeZone: event.timezone,
              // This page already holds the submission's files, so a completed upload task
              // here names what it received without a second read.
              files,
            })}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/**
 * `publicUrlFor` raises when `R2_PUBLIC_BASE_URL` is unset, which is correct for an
 * upload path and wrong for a read: a missing base URL should cost this page a link, not
 * the whole page.
 */
function safePublicUrl(objectKey: string): string | undefined {
  try {
    return publicUrlFor(objectKey, 'public')
  } catch {
    return undefined
  }
}
