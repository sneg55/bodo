// The auto-generated banner on the Welcome step, transcribed off ref 16:
//
//   Form submissions will be accepted until September 15 at 11:59 PM PDT.
//   Submission Limit: 3 submissions per user
//
// Two sentences with fixed wording and no improvements, because the parity docs
// control copy and familiarity is a scored axis. Both are pure so they are covered
// by tests rather than by squinting at the rendered card.

/**
 * The deadline in the EVENT's timezone with its abbreviation, not the viewer's. A
 * speaker in Berlin reading "11:59 PM" in their own zone would submit a day late,
 * and the abbreviation is the only thing on the card that says which clock is meant.
 *
 * The YEAR appears only when the deadline is not in the current one. Ref 16 has no year,
 * and same-year is the case it captured, so the transcribed string is what a speaker
 * reading a deadline weeks away still gets. A call for papers eight months out is the
 * case the reference does not cover: "April 30" for a 2027 deadline read as a date that
 * had already passed, which is the one misreading that costs a submission.
 */
export function deadlineSentence(
  closeDate: string,
  timezone: string,
  now: Date = new Date(),
): string | undefined {
  const at = Date.parse(closeDate)
  if (Number.isNaN(at)) return undefined
  const when = new Date(at)
  const zone = usableTimeZone(timezone)

  // Two formatters rather than one `dateStyle`/`timeStyle` pair, because the target
  // string has "at" between the halves and no comma after the day.
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    month: 'long',
    day: 'numeric',
    // Compared in the EVENT's zone on both sides, so a December 31 deadline does not
    // gain or lose its year depending on where the server is.
    year: yearIn(when, zone) === yearIn(now, zone) ? undefined : 'numeric',
  }).format(when)
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(when)

  return `Form submissions will be accepted until ${day} at ${time}.`
}

/** The calendar year an instant falls in, read in the given zone rather than the runtime's. */
function yearIn(when: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric' }).format(when)
}

/**
 * An Events row carries a timezone the organizer picked from a list, so this should
 * always hold. It is checked anyway because `Intl.DateTimeFormat` throws on an
 * unknown zone, and a typo in one settings field must not take the whole public
 * page down: showing the deadline in UTC is recoverable, an error page is not.
 */
function usableTimeZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0)
    return timezone
  } catch {
    return 'UTC'
  }
}

export function submissionLimitSentence(limit: number): string {
  return `Submission Limit: ${limit} submissions per user`
}

/**
 * The cap that applies to one submitter: the form's override when it has one, the
 * event default otherwise. BUILD_SPEC section 5.1 puts the default on the event and
 * lets a form override it, so resolving it in one function keeps the banner and the
 * server-side enforcement from disagreeing about which number is in force.
 */
export function resolveSubmissionLimit(input: {
  formLimit?: number
  eventLimit?: number
}): number | undefined {
  return input.formLimit ?? input.eventLimit
}
