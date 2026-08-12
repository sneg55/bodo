'use client'

// Step 2: who is submitting.
//
// Email plus name, and nothing else. The live walkthrough (docs/parity/public-cfp.md)
// found that Sessionboard probes the email and then branches into a password signup
// with a Terms checkbox. bodo does not: BUILD_SPEC section 4 is passwordless, so there
// is no password to set and no account to create here. The Speakers row is created by
// the submit itself, and the confirmation email carries the link into the portal.
//
// So this step collects and never blocks, which also means it cannot be used to
// discover whether an address already has an account. Nothing below probes the address
// either: the sign-in line is shown to everyone, so it says nothing about who typed what.
//
// The sign-in line is there because typing an address is not proof of controlling it, and
// `submitterBinding` (features/auth/submitter-identity.ts) is about to stop treating it as
// proof: a submission may only attach itself to a Speakers row that ALREADY EXISTS if this
// browser holds a session for that row. A returning speaker therefore needs a way to get one
// from here, and this is it. `/login` is a plain form posting to a route handler and the
// magic link is a GET navigation, so signing in still works with scripting off; `next` brings
// them back to this form, and the wizard's localStorage copy still holds their answers.

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WizardState } from '@/features/submissions/wizard-state'

export type AccountStepProps = {
  state: WizardState
  /** The address this browser has PROVED it controls, when it has proved one. */
  signedInEmail?: string
  /** `/login?next=<this form>`, built by the server component that knows the URL. */
  loginHref: string
  onChange: (patch: Partial<Pick<WizardState, 'email' | 'firstName' | 'lastName'>>) => void
}

export function AccountStep({ state, signedInEmail, loginHref, onChange }: AccountStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Get started</h2>
        <p className="text-sm text-muted-foreground">
          We use your email to send a confirmation and a link into your speaker portal. There is no
          password to create.
        </p>
      </div>

      {signedInEmail === undefined ? (
        <p className="text-sm text-muted-foreground">
          Submitted to this event before? Sign in with the same address first, so this is filed
          under the speaker profile you already have.{' '}
          <ButtonLink href={loginHref} variant="link" size="sm" className="h-auto p-0">
            Sign in
          </ButtonLink>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          You are signed in as {signedInEmail}. Use that address here to file this under your
          existing speaker profile.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="submitter-email">
          Your Email Address:
          <span aria-hidden className="text-destructive">
            *
          </span>
        </Label>
        <Input
          id="submitter-email"
          type="email"
          autoComplete="email"
          value={state.email}
          placeholder="you@example.com"
          onChange={(event) => onChange({ email: event.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="submitter-first-name">
            First Name
            <span aria-hidden className="text-destructive">
              *
            </span>
          </Label>
          <Input
            id="submitter-first-name"
            autoComplete="given-name"
            value={state.firstName}
            onChange={(event) => onChange({ firstName: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="submitter-last-name">
            Last Name
            <span aria-hidden className="text-destructive">
              *
            </span>
          </Label>
          <Input
            id="submitter-last-name"
            autoComplete="family-name"
            value={state.lastName}
            onChange={(event) => onChange({ lastName: event.target.value })}
          />
        </div>
      </div>
    </div>
  )
}
