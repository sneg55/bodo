// The part of the submit page that has to resolve the form before it can render.
//
// Still a separate component from page.tsx, because the page renders it inside
// `<Suspense>`: resolving the form is an Airtable read, and the card frame around it is
// not. The page awaits `params` and hands the two strings down, so this file no longer
// exists in order to hide a params read from a page body.
//
// The gate runs here, before a single step renders, which is what BUILD_SPEC section
// 5.1 asks for. The same gate runs again inside the Server Action, because a page that
// refuses to render cannot stop a POST.

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { sessionSpeaker } from '@/features/auth/wiring'
import { PUBLIC_FORM_REJECTIONS } from '@/features/submissions/gate'
import { resolvePublicForm } from '@/features/submissions/public-form'

import { SubmitWizard } from './SubmitWizard'

export type SubmitParams = {
  eventSlug: string
  formPublicId: string
}

export async function SubmitBody({ eventSlug, formPublicId }: SubmitParams) {
  const resolved = await resolvePublicForm({
    publicId: formPublicId,
    eventSlug,
    now: new Date(),
  })

  if (!resolved.open) {
    const copy = PUBLIC_FORM_REJECTIONS.get(resolved.reason)
    return (
      <Alert>
        <AlertTitle>{copy?.title ?? 'This form is not available'}</AlertTitle>
        <AlertDescription>{copy?.body ?? 'Ask the organizer for a current link.'}</AlertDescription>
      </Alert>
    )
  }

  // Read here rather than in the page, because the page renders this inside `<Suspense>`
  // and the session read is the same kind of thing the form resolution above is: a request
  // this page should not hold its first byte for. It NEVER refuses anyone. A stranger is
  // what this form is for, and the only difference a session makes is which sentence the
  // Account step shows and whether the submit may attach to a record that already exists
  // (features/auth/submitter-identity.ts).
  const signedIn = await sessionSpeaker()

  return (
    <SubmitWizard
      form={resolved.publicForm}
      signedInEmail={signedIn?.email}
      loginHref={`/login?next=${encodeURIComponent(`/submit/${eventSlug}/${formPublicId}`)}`}
    />
  )
}
