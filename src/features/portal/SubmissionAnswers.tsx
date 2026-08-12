// The submitted answers, read-only, in the form's own field order.
//
// Text and not markup, deliberately: `submittedAnswers` flattens stored rich text to
// text because this codebase has no HTML sanitizer, and putting a speaker's own markup
// through `dangerouslySetInnerHTML` would make an abstract a script that runs in the
// organizer's session. `whitespace-pre-line` keeps the paragraph breaks that survived.

import { Badge } from '@/components/ui/badge'
import type { AnswerRow } from '@/features/portal/answers-view'

export function SubmissionAnswers({ rows }: { rows: readonly AnswerRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No answers were recorded.</p>
  }

  return (
    <dl className="space-y-4">
      {rows.map((row) => (
        <div key={row.key} className="space-y-1">
          <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
          <dd className="text-sm">
            {row.values.length > 1 ? (
              <span className="flex flex-wrap gap-1.5">
                {row.values.map((value) => (
                  <Badge key={value} variant="secondary">
                    {value}
                  </Badge>
                ))}
              </span>
            ) : (
              <span className="whitespace-pre-line">{row.values.join('')}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
