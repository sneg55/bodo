'use client'

// What a reviewer gets where an organizer would get the surface: sent to their own queue.
//
// Shared by the `(organizer)` layout and the plan editor, which has to answer identically:
// the plan editor sits under `evaluation/`, deliberately outside that route group because
// the queue below it is the reviewer's, so it does its own admin check and would otherwise
// invent its own wording for the same refusal.
//
// IT USED TO BE A DEAD SCREEN: a card, a paragraph saying this part of the app was not
// theirs, and one button to the only place they could go. It was not rare either.
// `/admin/{id}` resolves to the `(organizer)` group, so this WAS every reviewer's landing
// page until `adminLandingPath` started routing them past it. What is left reaching this is
// a typed URL or a stale link, and that should not be a dead end either.
//
// WHY THE REDIRECT IS ON THE CLIENT, which looks like the wrong half of the app for it. A
// server `redirect()` here is a measured 500 rather than a style question: this renders
// under the `(organizer)` layout, which sits below `[eventId]/loading.tsx`, and that is a
// Suspense boundary. A redirect resolved after the shell has flushed never produces a
// response, so the Workers runtime cancels the request; `notFound()` fails the same way more
// quietly, answering HTTP 200 with the 404 body. Both are recorded against this exact layout
// in .claude/rules/bodo-conventions.md. Hoisting the check into `[eventId]/layout.tsx`,
// whose body runs before any boundary flushes, would work, but that layout has no pathname
// and would have to be told which of its children are organizer-only.
//
// Nothing is being PROTECTED by this navigation, which is what makes the client acceptable.
// The refusal already happened on the server: the layout withheld `children` and rendered
// this instead, and every action underneath authorizes itself (`requireEventRole`). This
// only decides where the browser goes next.
//
// `replace`, not `push`, so Back returns where they came from rather than to this.
//
// The link stays, and is still the whole content, because it is what a reviewer with
// scripting off gets. The copy is present tense: it says what is happening rather than what
// went wrong.

import { ShieldIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ReviewerAccessCard({ eventId }: { eventId: string }) {
  const router = useRouter()
  const href = `/admin/${eventId}/evaluation`

  useEffect(() => {
    router.replace(href)
  }, [router, href])

  return (
    <div className="flex min-w-0 justify-center py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-muted">
            <ShieldIcon className="size-4 text-muted-foreground" aria-hidden />
          </div>
          <CardTitle>Taking you to Evaluation</CardTitle>
          <CardDescription className="text-pretty">
            Your role on this event is reviewer, so your assigned submissions are in the review
            queue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* `href`, which main hoisted so the redirect effect above and this fallback link
              cannot point at different places. */}
          <ButtonLink href={href}>Go to Evaluation</ButtonLink>
        </CardContent>
      </Card>
    </div>
  )
}
