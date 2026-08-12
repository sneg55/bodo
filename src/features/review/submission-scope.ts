// The abstract/session split, as three surfaces over one table.
//
// Sessionboard's SUBMISSIONS section has three destinations (View All, Abstracts,
// Sessions) and bodo models all three as one record type, which the parity report states
// outright: "Abstracts and Sessions are the same entity shape ... bodo models this as one
// record type". So the three surfaces are one table read through one of these scopes, not
// three tables and not three row models.
//
// The discriminator is `reviewRequired`, and it is NOT a lookup through the form. It is
// stamped on the submission at creation from the form's `entityKind` and never re-read, so
// an organizer flipping a form from Sessions to Abstracts cannot retroactively drag
// confirmed speakers into a review queue. `features/dashboard/status-mix.ts` splits its
// donut on exactly this rule and explains the same reasoning at length; this module is the
// second reader of it, not a second definition.
//
// Pure, so it is unit tested (tests/submission-scope.test.ts).

export const SUBMISSION_SCOPES = ['all', 'abstracts', 'sessions'] as const

export type SubmissionScope = (typeof SUBMISSION_SCOPES)[number]

/** What a scope calls itself on screen. Titles are the sidebar's own words. */
export type SubmissionScopeCopy = {
  readonly title: string
  readonly subtitle: string
  /** The leftmost tab. "All Abstracts" is verbatim off the product; the others follow it. */
  readonly allTabLabel: string
  /**
   * What a sentence calls these rows: "Tick the abstracts...", "The selected sessions have no
   * files attached."
   *
   * Declared rather than derived from `allTabLabel` by stripping "All ", which is what the
   * bundle dialog did first. That trick reads the tab label as if it were a noun phrase, so a
   * label that is ever reworded silently reworders every sentence too. It is also the only
   * copy on this record that is not a heading, which is why it needs its own entry: the
   * server-side refusals in features/bundle/request.ts say the same nouns as the dialog, and
   * before this they always said "abstracts" while the organizer was looking at Sessions.
   */
  readonly plural: string
  readonly searchPlaceholder: string
  readonly emptyMessage: string
  /**
   * Whether the header offers the Add drawer.
   *
   * False on Sessions, and that is a deliberate omission rather than a gap. The drawer is
   * `+ Add Abstract` and the row it writes lands in this surface only when it is filed as
   * Accepted (`reviewRequiredFor` in features/submissions/manual-abstract.ts), so on
   * Sessions the button would usually add a row the organizer then cannot find. Add from
   * Abstracts or from View All, where the label is true.
   */
  readonly canAdd: boolean
}

// A Map rather than a record indexed by `scope`: a dynamic index into a plain object is
// what `security/detect-object-injection` flags, and abstracts-rows.ts already settled the
// house answer to that.
const ABSTRACTS_COPY: SubmissionScopeCopy = {
  // Ref 19's page header, verbatim.
  title: 'Abstracts',
  subtitle: 'Review and manage your abstract submissions',
  allTabLabel: 'All Abstracts',
  plural: 'abstracts',
  searchPlaceholder: 'Search abstracts...',
  emptyMessage: 'No abstracts found.',
  canAdd: true,
}

const COPY: ReadonlyMap<SubmissionScope, SubmissionScopeCopy> = new Map([
  [
    'all',
    {
      title: 'All Submissions',
      subtitle: 'Every abstract and session submission for this event',
      allTabLabel: 'All Submissions',
      plural: 'submissions',
      searchPlaceholder: 'Search submissions...',
      emptyMessage: 'No submissions found.',
      canAdd: true,
    },
  ],
  ['abstracts', ABSTRACTS_COPY],
  [
    'sessions',
    {
      title: 'Sessions',
      subtitle: 'Review and manage your session submissions',
      allTabLabel: 'All Sessions',
      plural: 'sessions',
      searchPlaceholder: 'Search sessions...',
      emptyMessage: 'No sessions found.',
      canAdd: false,
    },
  ],
])

export function scopeCopy(scope: SubmissionScope): SubmissionScopeCopy {
  // Every scope has an entry and the type says so, but a Map lookup is still optional:
  // falling back to Abstracts keeps the surface renderable rather than crashing a page.
  return COPY.get(scope) ?? ABSTRACTS_COPY
}

/**
 * A row belongs to a scope. `all` keeps everything, which is what View All is.
 *
 * SESSIONS IS THE PROGRAM, not merely the rows that skipped review, and that is a change
 * from the first reading of `reviewRequired`. Splitting the two surfaces on that flag alone
 * meant Sessions was empty forever on any event that runs a CFP: every submission through a
 * form is stamped `reviewRequired`, so an event with three accepted, scheduled, publicly
 * listed talks reported "No sessions found. ALL SESSIONS 0" while Abstracts and the Agenda
 * both showed the same three. An organizer reading the Sessions module would conclude the
 * program was empty.
 *
 * `docs/parity/agenda.md` reads the real product the other way: "Sessions are fed from
 * accepted abstracts ... implying an abstract is promoted into an agenda session on
 * acceptance". Marked an inference there, and it is the reading that makes the surface mean
 * something: a session is a thing that will be on the schedule, which is either an abstract
 * that was accepted or a row that never needed reviewing.
 *
 * An accepted abstract is therefore on BOTH surfaces, which is correct rather than a leak:
 * it is still an abstract that went through review, which is why the Abstracts tab strip has
 * an Accepted tab, and it is now also a session.
 */
export function inScope(
  row: { readonly reviewRequired: boolean; readonly status: string },
  scope: SubmissionScope,
): boolean {
  if (scope === 'all') return true
  if (scope === 'abstracts') return row.reviewRequired
  return !row.reviewRequired || row.status === 'accepted'
}

/**
 * Applied BEFORE the tab counts are taken, so the badges count the surface rather than the
 * event. A Sessions tab strip that counted every abstract would send an organizer looking
 * for rows this page will never show.
 */
export function filterScope<
  T extends { readonly reviewRequired: boolean; readonly status: string },
>(rows: readonly T[], scope: SubmissionScope): readonly T[] {
  return scope === 'all' ? rows : rows.filter((row) => inScope(row, scope))
}
