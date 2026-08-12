// What a team invitation actually says.
//
// THE DEFECT THIS FIXES: `addTeamMember` called `requestMagicLink`, which composes one
// message and only one, the generic `Your bodo sign-in link` with the body "Use this link to
// sign in. It works once and expires in 15 minutes." So somebody added to a conference's
// review committee received an unexplained sign-in link for a product they had never heard
// of, naming neither the event, nor the role, nor the fact that they had been invited to
// anything. That reads as a phishing attempt or a mistake, and the correct response to it is
// to ignore it, which is the opposite of what the organizer pressing `Add Member` wanted.
// `Resend invite` sent the same unexplained message again.
//
// It is a COMPOSER rather than a template row, and that is deliberate. Everything an
// organizer can edit lives in `EmailTemplates` and is resolved through
// `features/comms/resolve-template.ts`; this one is not offered there, because a magic link
// is a credential and a body an organizer can rewrite is a body from which the link can be
// deleted. An invitation nobody can act on is worse than one whose wording is fixed.
//
// The expiry is stated because it is short and surprising: fifteen minutes is fine for a
// link you asked for and is easy to miss on one that arrives unannounced, so the copy says
// what to do about it rather than leaving the reader to guess.

import type { EventRole } from '@/constants/status'
import { escapeHtml } from '@/features/comms/templates'

/**
 * "an admin" / "a reviewer": the role with its article, since the two differ.
 *
 * Lowercase prose rather than the `TEAM_ROLE_LABELS` chips, which are `Admin` and
 * `Reviewer` because they title a table column and a select. Mid-sentence in an email they
 * would read as a proper noun.
 */
const ROLE_PHRASES: ReadonlyMap<EventRole, string> = new Map([
  ['admin', 'an admin'],
  ['reviewer', 'a reviewer'],
])

/** What the role lets them do, so the message answers "why am I being sent this". */
const ROLE_CAPABILITIES: ReadonlyMap<EventRole, string> = new Map([
  ['admin', 'You can manage submissions, the agenda, the speaker portal and the team.'],
  ['reviewer', 'You can score the submissions assigned to you.'],
])

export type TeamInviteMessage = { readonly subject: string; readonly html: string }

/**
 * The invitation, given the event it is for and the role that was granted.
 *
 * Every interpolated value is escaped: the event name is organizer-controlled free text
 * ("AI & ML Summit" is the ordinary case, not the adversarial one), and the URL carries a
 * signed token whose base64url alphabet is safe but which is escaped anyway rather than
 * relying on that staying true.
 */
export function teamInviteEmail(input: {
  eventName: string
  role: EventRole
  url: string
}): TeamInviteMessage {
  const event = escapeHtml(input.eventName)
  const url = escapeHtml(input.url)
  const phrase = ROLE_PHRASES.get(input.role) ?? 'a team member'
  const capability = ROLE_CAPABILITIES.get(input.role) ?? ''

  return {
    // The event name leads, because that is the word the recipient recognizes. Unescaped
    // here on purpose: a subject line is not markup, and `&amp;` in one is a visible bug.
    subject: `You have been added to ${input.eventName} on bodo`,
    html: [
      '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">',
      `<p>You have been added to <strong>${event}</strong> as ${phrase}.</p>`,
      capability === '' ? '' : `<p>${capability}</p>`,
      `<p><a href="${url}">Sign in to ${event}</a></p>`,
      '<p style="color:#666;font-size:13px">This link works once and expires in 15 minutes.',
      ' If it has expired, request a new one from the sign-in page using this address.</p>',
      `<p style="color:#666;font-size:13px;word-break:break-all">${url}</p>`,
      '<p style="color:#666;font-size:13px">If you were not expecting this, ignore it.</p>',
      '</div>',
    ].join(''),
  }
}
