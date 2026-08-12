// The organizer's submission detail, as a server component.
//
// Composed from the portal's own detail pieces (`submittedAnswers`, `SubmissionAnswers`,
// `buildRoster`) rather than a second set. They read a submission and a form and know
// nothing about who is looking, which is exactly the property that lets the two surfaces
// share them; forking would give the organizer a roster that disagreed with the speaker's
// about who is primary. `buildRoster` takes the viewing speaker so it can mark "You", and
// there is no such person here, so `adminRosterRows` passes `undefined`.
//
// Participants is the one block that is NOT the portal's component. It was
// `SubmissionRoster` with no `edit` prop, which is read-only by construction, and that was
// the defect: with the cast frozen after creation, a session linked to the wrong duplicate
// speaker record could only be fixed by filing a second session. The organizer's version
// (`features/submissions/SubmissionParticipantsPanel`) adds, removes and repoints, on an
// `admin` check rather than on the speaker's ownership-plus-close-date one.
//
// Rich text is rendered as TEXT, not HTML, and that is `submittedAnswers`' decision
// rather than this file's. It matters more here than in the portal: the value is speaker
// authored markup, this codebase has no HTML sanitizer, and the reader is an organizer
// with an admin session. Putting it through `dangerouslySetInnerHTML` would make one
// speaker's abstract a script running with the organizer's cookies.

import Link from 'next/link'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { StatusChip } from '@/components/primitives/StatusChip'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { htmlToText, submittedAnswers } from '@/features/portal/answers-view'
import { SubmissionAnswers } from '@/features/portal/SubmissionAnswers'
import { ContentEditor } from '@/features/review/ContentEditor'
import { ContentStatusControl } from '@/features/review/ContentStatusControl'
import { abstractField, storedAbstract } from '@/features/review/content-edit'
import { ReviewHistory } from '@/features/review/ReviewHistory'
import { RATING_PLACEHOLDER } from '@/features/review/ratings'
import { SimilarPanel } from '@/features/review/SimilarPanel'
import type { SubmissionDetailView } from '@/features/review/submission-detail'
import {
  ADMIN_ROLE_OPTIONS,
  adminRosterRows,
  listRosterCandidates,
} from '@/features/submissions/roster-admin-view'
import { SubmissionParticipantsPanel } from '@/features/submissions/SubmissionParticipantsPanel'
import {
  sessionFormatLabel,
  sessionLanguageLabel,
  sessionLevelLabel,
} from '@/features/submissions/session-vocabulary'
import { cn } from '@/utils/cn'

export async function SubmissionDetailPanel({
  eventId,
  view,
  decisions,
}: {
  eventId: string
  view: SubmissionDetailView
  /**
   * The organizer's accept and decline controls, passed in rather than rendered here.
   * They are a client component and they live beside the route that owns them, and this
   * panel is a server component that must stay one: a reviewer gets `undefined` and the
   * read-only chip below, and ships none of that JavaScript.
   */
  decisions?: React.ReactNode
}) {
  const { submission, form, rating, reviews, revisions } = view
  const field = abstractField(form)
  // The Change speaker picker's options. Read here rather than in `loadSubmissionDetail`
  // because it belongs to the participants block and nothing else on this page wants it;
  // it is a tagged, cached DAL read (`event:{id}:speakers`), so on a warm cache it costs a
  // hit rather than a round trip.
  const candidates = await listRosterCandidates(eventId)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <ButtonLink href={`/admin/${eventId}/abstracts`} variant="ghost" size="sm">
          Back to Abstracts
        </ButtonLink>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{submission.code}</p>
              {/* `text-balance`: session titles are long enough to wrap here and CardTitle
                  is a `div`, so it does not pick up the h1-h3 balance rule in globals.css.
                  Unbalanced, a two-line title left one word on the second line. */}
              <CardTitle className="text-balance text-lg">{submission.title}</CardTitle>
            </div>
            {decisions ?? <StatusChip status={submission.status} withIcon />}
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {/* "Assigned track" and not "Track", because "Submitted answers" below also has a
              Track row and the two are different facts: this one is the organizer's own
              assignment on the submission record, that one is what the speaker picked on
              the form. They disagree routinely and nothing said which was which. */}
          <Meta label="Assigned track" value={view.trackName} />
          {/* Rendered through the vocabulary rather than printed raw. `format`, `level` and
              `language` are Airtable single-selects whose stored value is a canonical key,
              so this header read `talk` where the speaker had answered `Talk (30 min)`.
              Render-time only: the stored value stays canonical, because Airtable rejects
              the whole record on an undeclared choice. */}
          <Meta label="Format" value={sessionFormatLabel(submission.format)} />
          <Meta label="Level" value={sessionLevelLabel(submission.level)} />
          <Meta label="Language" value={sessionLanguageLabel(submission.language)} />
          {/* The committee's score, and it is the SAME number the Abstracts table shows for
              this row: one round's, human reviews only, chosen by `aggregateRoundFor`. This
              header used to pool every round in the plan and count the AI pre-screen, so one
              submission read 40% (3) here, 25% (1) in the table and 44% in the export. The
              round is named because the number is one round's and a reader comparing it with
              a per-round export needs to know which. */}
          <Meta
            numeric
            label={
              view.ratingRoundName === undefined ? 'Rating' : `Rating: ${view.ratingRoundName}`
            }
            value={
              rating.kind === 'scored'
                ? `${String(rating.percent)}% (${String(rating.reviewCount)})`
                : RATING_PLACEHOLDER[rating.kind]
            }
          />
          <ContentStatusControl
            eventId={submission.eventId}
            submissionId={submission.id}
            status={submission.contentStatus}
            canEdit={view.role === 'admin'}
          />
          {view.tagNames.length === 0 ? null : (
            <span className="flex flex-wrap items-center gap-1.5">
              {view.tagNames.map((name) => (
                <Badge key={name} variant="secondary">
                  {name}
                </Badge>
              ))}
            </span>
          )}
        </CardContent>
      </Card>

      {/* The organizer's own edit. Only shown to an admin: a reviewer never reaches this
          route at all (the (organizer) group refuses them), so this is belt and braces
          against a future route move rather than the access check itself. */}
      {view.role === 'admin' ? (
        <ContentEditor
          eventId={eventId}
          submissionId={submission.id}
          title={submission.title}
          abstract={storedAbstract(submission, field)}
          abstractLabel={field?.label}
        />
      ) : null}

      <Section title="Participants">
        <SubmissionParticipantsPanel
          eventId={eventId}
          submissionId={submission.id}
          rows={adminRosterRows(submission)}
          candidates={candidates}
          roles={ADMIN_ROLE_OPTIONS}
          canEdit={view.role === 'admin'}
        />
      </Section>

      {/* The heading is the speaker portal's own, verbatim, so the two surfaces cannot
          drift. The line under it is authored, and it is the other half of the Track
          ambiguity: it says whose answers these are. */}
      <Section
        title="Submitted answers"
        description="As the speaker filled them in. Organizer assignments are in the header above."
      >
        <SubmissionAnswers
          rows={submittedAnswers({ submission, form, lookups: { nameOf: view.nameOf } })}
        />
      </Section>

      {/* Between the abstract and the verdicts, which is where the finding is actionable: the
          organizer has just read the body, and "94% similar to SESS-142" is a reason to open
          that record BEFORE writing a decision, not after. Below the reviews it would be a
          footnote to a decision already made.

          Hidden when the sweep found nothing AND compared everything, because a card whose
          whole content is "No similar submissions." is a permanent fixture on every one of
          these pages that says nothing. It is NOT hidden when the cap dropped rows: an empty
          panel after a truncated sweep reads exactly like a clean one, which is the omission
          `SimilarPanel` and `SimilarityCoverage` both exist to refuse. */}
      {view.similar.neighbours.length === 0 && view.similar.dropped === 0 ? null : (
        <SimilarPanel neighbours={view.similar.neighbours} dropped={view.similar.dropped} />
      )}

      <Section title="Reviews">
        <ReviewHistory
          reviews={reviews}
          eventId={eventId}
          submissionId={submission.id}
          canOverride={view.role === 'admin'}
        />
      </Section>

      <Section title="Change history">
        {revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No edits recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {revisions.map((revision) => (
              <li key={revision.id} className="flex flex-col gap-1">
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">{revision.fieldLabel}</span> changed
                  by {revision.editorName} on {formatStamp(revision.at)}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Value label="Before" text={revision.previousValue} />
                  <Value label="After" text={revision.newValue} />
                </div>
                <Separator className="mt-2" />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function Meta({
  label,
  value,
  numeric = false,
}: {
  label: string
  value?: string
  /**
   * Renders the value with tabular figures. Only Rating sets it: that value is a
   * percentage and a review count, both of which move as the committee scores, and
   * proportional digits shift the rest of this wrapped row every time they do.
   */
  numeric?: boolean
}) {
  if (value === undefined || value === '') return null
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium', numeric && 'tabular-nums')}>{value}</span>
    </span>
  )
}

/**
 * The Before/After pair, as prose.
 *
 * Flattened through `htmlToText`, the same helper and the same reason as
 * `ContentVersionHistory`'s own `Value`: the abstract is a `wysiwyg` answer, so a stored
 * value is markup, and this block rendered it raw. That was harmless while only the title
 * was editable through this history; the abstract is editable through it now, so an
 * abstract entry read as literal `<p>Sharding, caching...</p>`. Never
 * `dangerouslySetInnerHTML`: the value is speaker-authored markup and there is no sanitizer
 * (see this file's header).
 */
function Value({ label, text }: { label: string; text: string }) {
  const prose = htmlToText(text)
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      {/* An emptied field is a fact worth showing rather than a blank box. Asked of the
          FLATTENED value, so markup that carries no prose reads as empty rather than as a
          change nobody can see. */}
      <p className="whitespace-pre-wrap break-words">
        {prose === '' ? <span className="text-muted-foreground">(empty)</span> : prose}
      </p>
    </div>
  )
}

/**
 * Formatted on the server, in UTC, deliberately. The event's own timezone is the right
 * answer for a session's start time and the wrong one for an audit stamp: the history
 * says when somebody typed, and that is not an event-local fact.
 */
function formatStamp(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(parsed)
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {description === undefined ? null : (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
