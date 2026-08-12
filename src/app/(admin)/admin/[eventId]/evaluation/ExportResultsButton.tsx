'use client'

// Download the review results for the round on screen.
//
// It lives HERE, on Evaluation, rather than in the Abstracts Options menu, because this is
// the results area: the rubric asks for "one row per submission with title, per-criterion or
// aggregate scores, recommendation, and review status", and none of the last three is a
// column on the submissions table. The Abstracts export stays what it is, the visible
// columns of the view you are looking at.
//
// The round comes from the tab strip above, so the file matches the progress numbers and the
// score sheet the chair is reading, rather than silently reporting on a different round.

import { DownloadIcon } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { exportReviewResultsCsvAction } from '@/features/review/export-actions'
import { downloadCsv } from '@/utils/download-csv'

export function ExportResultsButton({ eventId, roundId }: { eventId: string; roundId?: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await exportReviewResultsCsvAction({ eventId, roundId })
          // Surfaced rather than swallowed: the action refuses a non-admin and can fail on
          // a rate-limited base, and a button that does nothing is indistinguishable from
          // a download the browser put somewhere unexpected.
          if (!result.ok) {
            toast.error(result.message)
            return
          }
          downloadCsv(result.filename, result.csv)
        })
      }}
    >
      <DownloadIcon />
      Export results
    </Button>
  )
}
