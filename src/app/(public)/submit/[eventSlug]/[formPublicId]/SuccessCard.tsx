'use client'

// The success page, after the write.
//
// The organizer's `successHtml` is the body ("make sure this works" is stickered on
// that field in the walkthrough), and the countdown honours the form's
// auto-redirect-to-portal toggle: 10 seconds, otherwise a Continue to portal button.
// See BUILD_SPEC section 5.1's Form Settings step.
//
// The code is shown because it is the handle the speaker will use everywhere else:
// the portal lists submissions as `SESS-<n> - <title>`.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Badge } from '@/components/ui/badge'
import type { SubmitSuccess } from '@/features/submissions/actions'
import type { PublicForm } from '@/features/submissions/public-form'

const PORTAL_PATH = '/portal'
/** `next` so the link lands on the portal once the sign-in link has been followed. */
const SIGN_IN_PATH = `/login?next=${encodeURIComponent(PORTAL_PATH)}`
const REDIRECT_SECONDS = 10

export function SuccessCard({ form, result }: { form: PublicForm; result: SubmitSuccess }) {
  // The organizer's auto-redirect setting AND a session to redirect with. Without the
  // second half the countdown announced "taking you to your portal" and delivered a login
  // page, which is the worst of the three things it could have done: a submitter who has
  // read their confirmation code has ten seconds before the page changes under them.
  const remaining = useRedirectCountdown(form.autoRedirectToPortal && result.signedIn)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Badge variant="secondary">{result.code}</Badge>
        <h2 className="text-lg font-semibold">
          {result.reviewRequired ? 'Submission received' : 'You are confirmed'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {result.reviewRequired
            ? 'We have your submission. Track its status in your speaker portal.'
            : 'Your session is confirmed. Your next steps are waiting in your speaker portal.'}
        </p>
      </div>

      {form.successHtml === undefined ? null : (
        <div
          className="prose-sm max-w-none [&_a]:text-primary [&_a]:underline [&_li]:my-1 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
          // Organizer-authored rich text, already sanitized by `mapForm` at the read boundary.
          // This is a SECOND sink over the same class of value, which is why a per-sink fix was
          // the wrong shape: Codex review named this file specifically, and a third sink existed
          // in the portal. Sanitizing where the value is READ covers all of them. Never an answer.
          dangerouslySetInnerHTML={{ __html: form.successHtml }}
        />
      )}

      <div className="flex flex-col gap-1.5">
        {/* `render` plus `nativeButton={false}` is how this Button wraps a link: the
            base-ui primitive takes a render prop rather than shadcn's asChild.

            TWO DESTINATIONS, because there were two kinds of visitor here all along and
            only one of them could reach the portal. A signed-in speaker goes straight
            there; a first-time submitter is sent to the sign-in page deliberately and
            told why, rather than being promised their portal and silently bounced. */}
        <ButtonLink href={result.signedIn ? PORTAL_PATH : SIGN_IN_PATH} className="w-fit">
          {result.signedIn ? 'Continue to portal' : 'Sign in to your portal'}
        </ButtonLink>
        {result.signedIn ? null : (
          <p className="text-xs text-muted-foreground">
            Your portal needs a sign-in link. Enter the email you submitted with and we will send
            you one.
          </p>
        )}
        {remaining === undefined ? null : (
          <p className="text-xs text-muted-foreground">
            {`Taking you to your portal in ${remaining} ${remaining === 1 ? 'second' : 'seconds'}.`}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Counts down and navigates, or returns undefined when the form did not ask for a
 * redirect. Separated from the render so the effect has one job and the button above
 * works whether or not the countdown is running.
 */
function useRedirectCountdown(enabled: boolean): number | undefined {
  const router = useRouter()
  const [remaining, setRemaining] = useState(REDIRECT_SECONDS)

  useEffect(() => {
    if (!enabled) return
    if (remaining <= 0) {
      router.push(PORTAL_PATH)
      return
    }
    const timer = setTimeout(() => setRemaining((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [enabled, remaining, router])

  return enabled ? Math.max(0, remaining) : undefined
}
