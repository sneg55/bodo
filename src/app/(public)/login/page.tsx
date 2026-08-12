// Passwordless login. One field, one button, and the same answer every time.
//
// The response must not depend on whether the address has an account. A form that
// says "check your email" for a known address and "no such user" for an unknown one
// is an account enumerator, and this page is public. See BUILD_SPEC §4.
//
// One file, not a shell plus a `LoginBody` child inside `<Suspense>`. The split existed
// because `cacheComponents` refused a page body that read `searchParams`; nothing was
// being streamed behind it, because this page reads no data at all: the whole thing is
// the URL plus static copy.

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { DEMO_LOGIN_PATH } from '@/features/auth/demo-login'
import { MAGIC_LINK_PATH } from '@/features/auth/magic-link'
import { isDemoMode } from '@/utils/env'

export const metadata = {
  title: 'Sign in to bodo',
}

/** Why a link failed, in words a speaker can act on. */
const ERRORS = new Map<string, string>([
  ['expired', 'That link has expired. Links are good for 15 minutes; request a new one.'],
  ['used', 'That link has already been used. Request a new one.'],
  ['invalid', 'That link is not valid. Request a new one.'],
  ['missing', 'That link was incomplete. Request a new one.'],
  ['missing_email', 'Enter the email address you submitted with.'],
  // Set by /admin-mode when the session ends rather than returning: the admin who started
  // it no longer holds a role on the event, so there is no admin session to go back to.
  [
    'admin_mode',
    'Your access to that event has changed, so the session ended. Sign in again to continue.',
  ],
  // Deliberately says the fault is ours and names no address, so it is safe on a public
  // page: an unconfigured provider is not a fact about whoever happens to be typing.
  // Telling them to try again would be a lie, because nothing about retrying helps.
  [
    'undeliverable',
    'Sign-in email is not configured on this deployment, so no link could be sent. This is a fault on our side, not a problem with your address. Contact the organizer.',
  ],
  // Both set by /api/auth/demo. Neither names an address, because nobody typed one:
  // the demo identities come from this deployment's own configuration, so a failure
  // here is ours to fix and there is nothing for the visitor to correct.
  [
    'demo_unavailable',
    'The demo account for that role is not set up on this deployment, so there was nothing to sign in to. Contact the organizer.',
  ],
  ['demo_persona', 'That demo role does not exist. Pick one of the buttons above.'],
])

export type LoginSearchParams = {
  error?: string
  next?: string
  sent?: string
  audience?: string
  /** Set by /logout, so a deliberate sign-out does not read as an expired session. */
  signed_out?: string
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>
}) {
  const { error, next, sent, audience, signed_out: signedOut } = await searchParams
  const message = error === undefined ? undefined : ERRORS.get(error)

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to bodo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Outside the sent/not-sent branch below on purpose: someone who has already
              asked for a link and is tired of waiting for it should still be able to
              click straight in, which is the whole point of the door. */}
          {isDemoMode() && (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Demo mode</p>
                <p className="text-xs text-muted-foreground">
                  Sign in as a seeded account to look around. Everyone who visits this deployment
                  shares the same data.
                </p>
              </div>
              {/* One form, three submits, each carrying its own persona. A plain POST, so
                  the demo works with scripting off like every other way in. */}
              <form action={DEMO_LOGIN_PATH} method="post" className="grid gap-2">
                <Button type="submit" name="persona" value="admin" variant="secondary">
                  Continue as organizer
                </Button>
                <Button type="submit" name="persona" value="reviewer" variant="secondary">
                  Continue as reviewer
                </Button>
                <Button type="submit" name="persona" value="speaker" variant="secondary">
                  Continue as speaker
                </Button>
              </form>
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <Separator className="flex-1" />
              </div>
            </div>
          )}
          {sent === '1' ? (
            <Alert>
              <AlertDescription>
                Check your email. If an account exists for that address, a sign-in link is on its
                way. The link is good for 15 minutes and works once.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              {signedOut === '1' && (
                <Alert>
                  <AlertDescription>
                    You are signed out. Request a new link to sign back in.
                  </AlertDescription>
                </Alert>
              )}
              {message !== undefined && (
                <Alert variant="destructive">
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
              )}

              {/* A plain form posting to a route handler, so signing in works with no
                  JavaScript at all. The link in an inbox is a navigation, not a fetch. */}
              <form action={MAGIC_LINK_PATH} method="post" className="space-y-4">
                <Input type="hidden" name="next" value={next ?? ''} readOnly />
                <Input type="hidden" name="audience" value={audience ?? 'speaker'} readOnly />
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                  />
                </div>
                <Button type="submit" className="w-full">
                  Email me a sign-in link
                </Button>
              </form>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            bodo has no passwords. Every sign-in is a fresh single-use link.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
