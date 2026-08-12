// Print a sign-in link for a local server, without sending any email.
//
// Two ways to sign in locally, and this is the second one:
//
//   1. Submit the login form. With no email provider configured, `/api/auth/magic`
//      logs the link to the server's own output rather than dead-ending, so the link
//      is in the `next dev` or `cf:preview` terminal. Nothing else is needed.
//   2. This script, for when reading the server log is inconvenient: a scripted
//      check, a fresh browser profile, or picking a specific seeded account fast.
//
// `.mts` and not `.ts` on purpose: tsx compiles a `.ts` here to CJS, where the
// top-level await below is a syntax error.
//
// Usage:
//   npm run dev:login -- <email> [speaker|admin] [redirectTo]
//
// The origin defaults to APP_URL, so it follows whichever local server the env file
// describes. Pass BODO_LOGIN_ORIGIN to override it for a one-off.

import { requestMagicLink } from '@/features/auth/magic-link'
import { resolveLoginSubject } from '@/features/auth/resolve-subject'
import { appUrl, isLocalDeploy } from '@/utils/env'

const [email, audienceArg, redirectTo] = process.argv.slice(2)

if (email === undefined || email.trim() === '') {
  console.error('usage: npm run dev:login -- <email> [speaker|admin] [redirectTo]')
  process.exit(1)
}

// The token this mints is a real, working credential for whoever holds it. Minting
// one against a production config from a developer's shell is never what was meant.
if (!isLocalDeploy()) {
  console.error(`refusing to mint a sign-in link: DEPLOY_ENV is not "local"`)
  process.exit(1)
}

const audience = audienceArg === 'admin' ? 'admin' : 'speaker'
const origin = process.env.BODO_LOGIN_ORIGIN ?? appUrl()

// A capturing `send` rather than the real one, so this stays a read of the token
// mint and never touches an email provider even if one happens to be configured.
let link: string | undefined
const { expiresAtMs } = await requestMagicLink({
  email,
  audience,
  nowMs: Date.now(),
  origin,
  redirectTo,
  resolveSubject: resolveLoginSubject,
  send: (message) => {
    link = /href="([^"]+)"/.exec(message.html)?.[1]
    return Promise.resolve({ delivered: true, messageId: 'dev-login' })
  },
})

if (link === undefined) {
  console.error('a link was minted but could not be read back out of the email body')
  process.exit(1)
}

console.log(link)
console.error(`(${audience} · expires ${new Date(expiresAtMs).toISOString()})`)
