// /portal/submissions/[code]: one submission, addressed by the code the portal shows a
// speaker (`SESS-<n>`), which BUILD_SPEC 5.2 treats as an addressable key.
//
// The lookup and the `notFound()` happen in THIS body, before the first byte, and that is
// not a style choice: `notFound()` from inside the `<Suspense>` below resolves after the
// shell has flushed, so the status line has already gone out as 200 and a bogus code
// answered 200 with the 404 page. Same rule the conventions file gives for `redirect()`.
// Confirmed on the deployed Worker: the sibling `/portal/resources/[slug]` returns 404
// precisely because it resolves in its page body, and this one did not.
//
// The boundary is kept, because it still has something to stream: the detail component's
// own tracks and tags reads sit behind it while the portal frame and title paint.

import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { PortalFrame } from '@/features/portal/PortalFrame'
import { readOwnSubmissionByCode } from '@/features/portal/reads'
import { SubmissionDetail } from '@/features/portal/SubmissionDetail'

export const metadata = { title: 'Submission' }

export default async function PortalSubmissionPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const detail = await readOwnSubmissionByCode(decodeURIComponent(code))
  if (detail === undefined) notFound()

  return (
    <PortalFrame pageTitle="Submissions" activeNav="submissions">
      <Suspense
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        }
      >
        <SubmissionDetail detail={detail} />
      </Suspense>
    </PortalFrame>
  )
}
