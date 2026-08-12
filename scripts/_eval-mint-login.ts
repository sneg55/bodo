// Mints a bodo magic-link URL for a persona, so a headless eval agent can sign in
// without an inbox. This is the scripted equivalent of the eval kit's
// `sbek auth --persona <name>` step, which assumes a human with a mailbox.
//
// Lives in the scratchpad on purpose: it is eval scaffolding, not product code, and
// it must never ship. It calls the app's own resolver and its own token minter, so a
// link it produces is byte-identical to one the login form would have emailed.
//
// Usage:  npx tsx mint-login.ts <email> <admin|speaker> [redirectTo]

import { magicLinkUrl } from '@/features/auth/magic-link'
import { resolveLoginSubject } from '@/features/auth/resolve-subject'
import { authSecret, mintMagicLinkToken } from '@/features/auth/tokens'

async function main() {
  const [email, audience = 'admin', redirectTo] = process.argv.slice(2)

  if (!email) {
    console.error('usage: tsx mint-login.ts <email> <admin|speaker> [redirectTo]')
    process.exit(1)
  }

  const origin = process.env.EVAL_ORIGIN ?? 'http://localhost:8787'

  const subject = await resolveLoginSubject({
    email: email.trim().toLowerCase(),
    audience: audience as 'admin' | 'speaker',
  })

  if (subject === undefined) {
    console.error(`NO ACCOUNT: ${email} has no ${audience} record in this base`)
    process.exit(2)
  }

  const minted = await mintMagicLinkToken({
    subject,
    nowMs: Date.now(),
    secret: authSecret(),
    redirectTo,
  })

  console.log(
    JSON.stringify(
      {
        email,
        audience,
        subject,
        url: magicLinkUrl({ token: minted.token, origin }),
        expiresAt: new Date(minted.expiresAtMs).toISOString(),
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
