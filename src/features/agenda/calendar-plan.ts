// What a schedule change does to a speaker's calendar.
//
// This decides three things and nothing else: whether a schedule write should produce an
// invite, a cancellation, or nothing at all; which UID that message carries; and which
// SEQUENCE. Pure, because those three answers are the whole judged property in
// BUILD_SPEC 5.3 and they are miserable to debug through a mailbox.
//
// The rules, and where each comes from:
//
//   1. **Invites follow the SCHEDULE, not the publication.** BUILD_SPEC 5.4 says so in as
//      many words: "Publishing does not send calendar invites; those follow the schedule
//      change." Publishing is an editorial act about a public web page, and a speaker whose
//      time did not move must not get a second copy of the same invite because an organizer
//      pressed Publish.
//   2. **The first invite is SEQUENCE 0**, and every later one is the stored sequence plus
//      one (§3: "calendarSequence (number, starts 0)", §5.3: "increments on every subsequent
//      send"). A client treats same-UID-higher-SEQUENCE as an update and same-UID-same-
//      SEQUENCE as a duplicate to ignore, so an off-by-one here does not error, it leaves
//      every speaker sitting on the old time.
//   3. **The UID is minted once and stored**, never derived. §5.3 is explicit that deriving
//      it from a record id looks identical and breaks silently if a record is recreated. So
//      the mint is injected rather than called here, and this stays deterministic.
//   4. **Unscheduling an invited session cancels it.** Without the cancel path a withdrawn
//      session sits on every speaker's calendar forever. Cancelling twice is not a thing:
//      once `calendarStatus` is `cancelled` there is nothing left to withdraw.

export type CalendarStatus = 'active' | 'cancelled'
export type ScheduleStatus = 'unscheduled' | 'scheduled' | 'published'

/** The submission's calendar-relevant state, before or after a write. */
export type CalendarSlot = {
  readonly scheduleStatus: ScheduleStatus
  readonly startsAt?: string
  readonly endsAt?: string
  readonly roomId?: string
}

export type CalendarIdentity = {
  /** Absent until the first invite goes out. */
  readonly calendarUid?: string
  readonly calendarSequence: number
  readonly calendarStatus: CalendarStatus
}

export type CalendarPlan =
  | { readonly action: 'none'; readonly reason: string }
  | {
      readonly action: 'invite' | 'cancel'
      readonly uid: string
      /** The SEQUENCE this message carries, and the value to store on the row. */
      readonly sequence: number
      readonly status: CalendarStatus
    }

export type PlanInput = {
  readonly identity: CalendarIdentity
  readonly before: CalendarSlot
  readonly after: CalendarSlot
  /** Called at most once, and only when a first invite is being issued. See rule 3. */
  readonly mintUid: () => string
}

/** A slot is real when it has all three of room, start, and end, and is not in the tray. */
function scheduled(slot: CalendarSlot): boolean {
  return (
    slot.scheduleStatus !== 'unscheduled' &&
    slot.roomId !== undefined &&
    slot.startsAt !== undefined &&
    slot.endsAt !== undefined
  )
}

/** Rule 1: publication is not a move. Only room and the two times are. */
function moved(before: CalendarSlot, after: CalendarSlot): boolean {
  return (
    before.roomId !== after.roomId ||
    before.startsAt !== after.startsAt ||
    before.endsAt !== after.endsAt
  )
}

export function planCalendarChange(input: PlanInput): CalendarPlan {
  const { identity, before, after } = input
  const invited = identity.calendarUid !== undefined

  if (!scheduled(after)) {
    if (!invited) return { action: 'none', reason: 'never invited, so nothing to cancel' }
    if (identity.calendarStatus === 'cancelled') {
      return { action: 'none', reason: 'already cancelled' }
    }
    return {
      action: 'cancel',
      // Non-null by `invited`. Narrowed through a local so the check and the use are the
      // same expression.
      uid: identity.calendarUid ?? '',
      sequence: identity.calendarSequence + 1,
      status: 'cancelled',
    }
  }

  if (!invited) {
    // Rule 2: the first one is 0, not 1. The stored default is also 0, which is why the
    // row's sequence is not consulted here: an uninvited session and a session on its
    // first invite are the same number, and only the UID tells them apart.
    return { action: 'invite', uid: input.mintUid(), sequence: 0, status: 'active' }
  }

  const uid = identity.calendarUid ?? ''

  // A session that was cancelled and is now scheduled again is a fresh REQUEST on the same
  // UID, which is what puts it back on the calendar it was removed from. It counts as a
  // move even when the slot is unchanged, because the last thing the speaker's client saw
  // was a CANCEL.
  if (identity.calendarStatus === 'cancelled') {
    return { action: 'invite', uid, sequence: identity.calendarSequence + 1, status: 'active' }
  }

  if (!moved(before, after)) {
    return { action: 'none', reason: 'the slot did not change' }
  }

  return { action: 'invite', uid, sequence: identity.calendarSequence + 1, status: 'active' }
}
