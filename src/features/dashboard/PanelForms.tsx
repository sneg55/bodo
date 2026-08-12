// The Submission Forms sub-tab, refs 34 and 35: Submission Pacing, then "Your forms", then
// Recent Submissions.
//
// The panel does the mapping the two list components need (a form's name for the Source chip,
// tag NAMES rather than record ids, a timestamp formatted in the event's timezone) and the
// aggregates come from `home-view.ts` and `pacing.ts`, so nothing in here is arithmetic.

import { RecentSubmissionsTable, YourForms } from '@/features/dashboard/HomeLists'
import { formProgress, recentSubmissions } from '@/features/dashboard/home-view'
import { submissionPacing } from '@/features/dashboard/pacing'
import type { Event, SubmissionWithParticipants, Tag } from '@/types/domain'
import type { Form } from '@/types/forms'

import { PacingCard } from './PacingCard'

/** How many rows Recent Submissions shows before deferring to Abstracts. */
const RECENT_LIMIT = 8

export function PanelForms({
  event,
  submissions,
  forms,
  tags,
  now,
  at,
}: {
  event: Event
  submissions: readonly SubmissionWithParticipants[]
  forms: readonly Form[]
  tags: readonly Tag[]
  now: Date
  at: (path: string) => string
}) {
  const progress = formProgress({ forms, submissions, now })
  // Every form, CFP and portal alike, because Recent Submissions resolves a submission's
  // source name through this and only needs a name. `formProgress` filters to CFP itself, so
  // the "Your forms" row cannot pick a portal form up from here.
  const formById = new Map(forms.map((form) => [form.id, form]))
  // Ref 35's Tags column shows names. `tagIds` holds record ids, and printing one at an
  // organizer is the same bug the CFP review step had.
  const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]))

  return (
    <div className="flex flex-col gap-6">
      <PacingCard view={submissionPacing({ submissions, event, now })} />

      <YourForms
        forms={progress.forms}
        submitted={progress.submitted}
        receiving={progress.receiving}
        editHref={(formId) => at(`/forms/${formId}`)}
        // Only a published CFP form has a public URL, and previewing a draft would show the
        // organizer something no speaker can reach, so a draft gets no View button.
        previewHref={(form) => {
          const source = formById.get(form.id)
          if (source === undefined || source.status !== 'published') return undefined
          // Belt and braces with `formProgress`'s own filter: `/submit/...` is a CFP route, so
          // a portal form must never be offered one even if it reached this callback.
          if (source.kind !== 'cfp') return undefined
          return `/submit/${event.slug}/${source.publicId}`
        }}
      />

      <RecentSubmissionsTable
        rows={recentSubmissions(submissions, RECENT_LIMIT).map((submission) => ({
          id: submission.id,
          code: submission.code,
          title: submission.title,
          status: submission.status,
          sourceName: formById.get(submission.formId ?? '')?.name,
          speakers: submission.participants.map((participant) =>
            `${participant.speaker.firstName} ${participant.speaker.lastName}`.trim(),
          ),
          tags: submission.tagIds
            .map((id) => tagNameById.get(id))
            .filter((name): name is string => name !== undefined),
          submittedLabel: submittedLabel(submission.submittedAt, event.timezone),
        }))}
        viewAllHref={at('/abstracts')}
      />
    </div>
  )
}

/**
 * Formatted on the server in the EVENT's timezone, so this cannot render one date on the
 * server and another in the browser. Ref 35 shows a long form with the zone name, which is
 * what an organizer needs when the event is not in their own timezone.
 */
function submittedLabel(submittedAt: string | undefined, timeZone: string): string {
  if (submittedAt === undefined) return '-'
  const instant = Date.parse(submittedAt)
  if (Number.isNaN(instant)) return '-'
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone,
    }).format(new Date(instant))
  } catch {
    // `Events.timezone` is free text, so an unrecognised value would throw RangeError here
    // exactly as it did across the agenda surfaces. Same guard, same reason.
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(instant),
    )
  }
}
