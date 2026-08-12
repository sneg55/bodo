// The public call for papers, at /submit/<event-slug>/<form-publicId>.
//
// The form's publicId is in the URL because an event has many forms and a bare event
// slug cannot say which one to render. The organizer gets this link from Copy Link in
// the builder header. See BUILD_SPEC section 5.1 and docs/parity/public-cfp.md.
//
// This body resolves `params` and draws the card. The form resolution stays behind
// `<Suspense>`, and that split is kept on purpose: this is the one public page with an
// Airtable read in front of it (resolve the form, apply the gate), it has no `loading.tsx`
// to fall back on, and a visitor arriving from a cold link should see the card immediately
// rather than a blank tab while the form is looked up.

import { Suspense } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { resolvePublicForm } from '@/features/submissions/public-form'

import { SubmitBody, type SubmitParams } from './SubmitBody'

/**
 * `<event name> - <form title>`, which is what the reference's live page title was.
 *
 * The tab said "Submit a session" for every event and every form, so a speaker with three
 * calls for papers open had three identical tabs. Resolving the form here costs nothing
 * extra: it is the same cached read `SubmitBody` makes below, so the second call is served
 * from the request's cache rather than hitting Airtable twice.
 *
 * A form that is closed, missing or on the wrong event keeps the generic title. The body
 * renders a rejection notice in that case, and putting an event name on a tab whose page
 * refuses to say anything about that event would be the wrong kind of confident.
 */
export async function generateMetadata({ params }: { params: Promise<SubmitParams> }) {
  const { eventSlug, formPublicId } = await params
  const resolved = await resolvePublicForm({ publicId: formPublicId, eventSlug, now: new Date() })
  if (!resolved.open) return { title: 'Submit a session' }

  const form = resolved.publicForm
  const heading = (form.externalTitle ?? '').trim()
  return { title: heading.length === 0 ? form.eventName : `${form.eventName} - ${heading}` }
}

export default async function SubmitPage({ params }: { params: Promise<SubmitParams> }) {
  const { eventSlug, formPublicId } = await params

  return (
    <main className="min-h-screen bg-muted/40 p-4 sm:p-8">
      {/* Centered card on a neutral page, no admin chrome. This is the public shell
          from ref 16, and it is the whole layout: no sidebar, no top bar. */}
      <Card className="mx-auto w-full max-w-3xl">
        <CardContent>
          <Suspense fallback={<SubmitSkeleton />}>
            <SubmitBody eventSlug={eventSlug} formPublicId={formPublicId} />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  )
}

function SubmitSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-6 w-full max-w-lg" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-9 w-24 self-end" />
    </div>
  )
}
