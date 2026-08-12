// Email to session subject. The data-layer half of the magic-link flow.
//
// `requestMagicLink` takes this as an argument rather than doing the lookup itself
// because the two audiences have opposite rules, and getting them the same way
// round would be a security bug in one direction and a dead end in the other:
//
//   admin    strictly look up. An address with no AdminUsers row gets no link, and
//            certainly no account. Creating one on demand would let anybody grant
//            themselves an admin session by typing an email.
//   speaker  look up only. A speaker row is created by submitting to a form (CFP
//            step 2), not by asking for a login link, so an unknown address here
//            genuinely has nothing to sign in to.
//
// Both return `undefined` rather than throwing for "no account", because that is an
// ordinary answer and the route above must give the same response either way. A
// login form that behaves differently for a known address is an account enumerator.

import type { SubjectResolver } from '@/features/auth/magic-link'
import { findAdminUserByEmail, findSpeakerByEmail } from '@/services/airtable/queries'

export const resolveLoginSubject: SubjectResolver = async ({ email, audience }) => {
  if (audience === 'admin') {
    const user = await findAdminUserByEmail(email)
    return user === undefined ? undefined : { kind: 'user', userId: user.id }
  }

  const speaker = await findSpeakerByEmail(email)
  return speaker === undefined ? undefined : { kind: 'speaker', speakerId: speaker.id }
}
