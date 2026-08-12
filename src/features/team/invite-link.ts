'use server'

// Hand a team member their sign-in link directly, instead of only mailing it.
//
// The gap: an invited reviewer can ONLY get in through a magic link, the link only exists in
// a mailbox, and nothing in the product shows it. So an organizer setting up a committee in a
// room with the reviewer sitting next to them, or handing an event over, or checking that
// their reviewer surface works at all, has no move. "Resend invite" sends the same
// unreachable mail again.
//
// WHO IT MAY BE HANDED FOR is the whole of the design, because a magic link is an ACCOUNT
// credential and an `AdminUsers` row can be a member of several events. An admin of event A
// copying a link for somebody who also administers event B would be taking B, which is an
// escalation A never had. So the link is offered only when this event is the person's ONLY
// membership: then the link grants exactly what the admin doing the copying already holds
// here, and nothing else. Anyone with a second membership is refused, in those words, and
// the invite email remains their route in.
//
// It MINTS rather than sending. `requestMagicLink` mails as part of minting, and a copy
// button that also fired mail would be a second message the organizer did not ask for.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { magicLinkUrl } from '@/features/auth/magic-link'
import { authSecret, mintMagicLinkToken } from '@/features/auth/tokens'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { readTeamMembersForWrite } from '@/features/team/reads'
import { listMembershipsForUser } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'
import { appUrl } from '@/utils/env'

export type InviteLink = {
  readonly email: string
  readonly url: string
  /** Minutes until it stops working, for the copy beside it. */
  readonly expiresInMinutes: number
}

export async function inviteLinkAction(input: {
  eventId: RecordId
  membershipId: RecordId
}): Promise<ActionResult<InviteLink>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    // The UNCACHED team read, the one the other team writes branch on: this decides whether
    // a credential is handed over, so it must not be answered from a list that is a minute
    // old and may no longer contain this person.
    const member = (await readTeamMembersForWrite(input.eventId)).find(
      (row) => row.membershipId === input.membershipId,
    )
    if (member === undefined) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that member is not on this team', {
        eventId: input.eventId,
      })
    }

    const memberships = await listMembershipsForUser(member.userId)
    const elsewhere = memberships.filter((row) => row.eventId !== input.eventId)
    if (elsewhere.length > 0) {
      throw new AppError(
        ErrorIds.AUTH_FORBIDDEN_ROLE,
        `${member.email} is on other events too, so their sign-in link cannot be shown here. Use Resend invite instead.`,
        { eventId: input.eventId, membershipId: input.membershipId },
      )
    }

    const minted = await mintMagicLinkToken({
      subject: { kind: 'user', userId: member.userId },
      nowMs: Date.now(),
      secret: authSecret(),
      redirectTo: `/admin/${input.eventId}`,
    })

    return actionOk({
      email: member.email,
      url: magicLinkUrl({ token: minted.token, origin: appUrl() }),
      // Derived from what was actually minted rather than restating the constant, so the
      // number on screen cannot drift from the token's real lifetime.
      expiresInMinutes: Math.max(1, Math.round((minted.expiresAtMs - Date.now()) / 60_000)),
    })
  } catch (error) {
    return actionFailure(error)
  }
}
