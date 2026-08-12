// The blockers for the current step, listed above the footer.
//
// A gated Next button with no explanation is the failure mode this exists to avoid:
// the speaker sees a disabled button and has no way to learn which of fourteen
// questions is the problem. Field-attributed problems also render beside their own
// control (FieldControl), so this list is the summary rather than the only copy.

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { Problem } from '@/features/forms/validate'

export function ProblemList({ problems }: { problems: readonly Problem[] }) {
  if (problems.length === 0) return null
  return (
    <Alert variant="destructive">
      <AlertTitle>
        {problems.length === 1
          ? 'One thing needs attention'
          : `${problems.length} things need attention`}
      </AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {problems.map((problem, index) => (
            <li key={`${problem.code}-${problem.fieldId ?? problem.participantId ?? index}`}>
              {problem.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Messages for one control, keyed by field id. Built once per render rather than
 * filtered per field, so a form with fifty questions does not scan the problem list
 * fifty times.
 */
export function problemsByField(problems: readonly Problem[]): ReadonlyMap<string, string[]> {
  const byField = new Map<string, string[]>()
  for (const problem of problems) {
    const fieldId = problem.fieldId
    if (fieldId === undefined) continue
    const existing = byField.get(fieldId)
    if (existing === undefined) {
      byField.set(fieldId, [problem.message])
    } else {
      existing.push(problem.message)
    }
  }
  return byField
}
