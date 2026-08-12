'use client'

// The speaker CSV import, as four steps over the shared `StepWizard`.
//
// State is client-side and there is no batch table behind it: a half-finished import is not
// something anyone should be able to find later, and storing parsed rows server-side would
// mean a second write path with its own lifecycle for no gain. Close the tab and the import is
// gone, which is the honest behaviour for a file that never left the browser.
//
// The file never leaves the browser, in fact, until the commit: `parseCsv` runs here, the
// mapping runs here, and only the mapped rows are sent. That is what keeps a column the
// organizer chose to ignore from ever reaching the server, and it is why the row cap can be
// enforced as a sentence on the upload step rather than as an error after a long upload.
//
// What the primitive owns and this file does not: step order, Back/Continue, which steps are
// reachable, the disabled gate and its `aria-describedby` explanation, and the busy state.
// This file owns every step's data; the blocker strings and the gate are in `wizard-gates.ts`,
// and the step bodies are in `ImportStepBody.tsx`. Both are where they are unit tested.
//
// `StepWizard` is CONTROLLED, so `current` lives here, and that is what this wizard needs
// rather than a convenience: the preview step's duplicate check is a server round trip fired
// on arrival, and its answer has to survive the step changes on either side of it. There is no
// separate "furthest reached" cursor - the gate is `gated` mode over
// `completedImportSteps()`, so a step edited back into an invalid state closes the steps after
// it again instead of leaving them reachable on the strength of a visit.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { StepWizard } from '@/components/primitives/StepWizard'
import { Button } from '@/components/ui/button'
import {
  commitSpeakerImportAction,
  type ImportCommitted,
  previewSpeakerImportAction,
} from '@/features/crm/import/actions'
import { type ParsedCsv, parseCsv } from '@/features/crm/import/csv-parse'
import { findDuplicates } from '@/features/crm/import/dedup'
import {
  buildErrorCsv,
  type ImportProblem,
  importErrorRows,
} from '@/features/crm/import/error-report'
import { ImportStepBody } from '@/features/crm/import/ImportStepBody'
import type { ImportEventOption } from '@/features/crm/import/ImportUploadStep'
import { autoMapHeaders } from '@/features/crm/import/map-row'
import {
  completedImportSteps,
  IMPORT_STEPS,
  type ImportWizardState,
  stepBlockers,
  uploadSizeMessage,
} from '@/features/crm/import/wizard-gates'
import {
  attemptIdAfter,
  type ColumnChoice,
  choicesFromMapping,
  chooseColumn,
  dispositions,
  fileRowNumber,
  mappingFromChoices,
  mapRows,
} from '@/features/crm/import/wizard-state'
import type { SpeakerImportRow } from '@/services/airtable/mutations-crm-import-plan'
import { downloadCsv } from '@/utils/download-csv'

export type ImportWizardProps = {
  /** The viewer's events, from their own EventMemberships. The action re-checks the choice. */
  events: readonly ImportEventOption[]
}

/** Heading and one line under it, per step. A Map, so a step id cannot index an object. */
const STEP_TITLES: ReadonlyMap<string, { readonly title: string; readonly description: string }> =
  new Map([
    [
      'upload',
      {
        title: 'Upload a file to import',
        description: 'A CSV of speakers. Nothing is written until the last step.',
      },
    ],
    [
      'map',
      {
        title: 'Map columns',
        description: 'Point each column in your file at a speaker field, or ignore it.',
      },
    ],
    ['preview', { title: 'Preview', description: 'What the import will do to each row.' }],
    ['commit', { title: 'Commit', description: 'Write the rows to the CRM.' }],
  ])

/** A wrapper, not `crypto.randomUUID` passed by reference, which loses its receiver. */
const mintAttemptId = (): string => crypto.randomUUID()

export function ImportWizard({ events }: ImportWizardProps) {
  const [current, setCurrent] = useState('upload')
  const [eventId, setEventId] = useState(events[0]?.id ?? '')
  const [fileName, setFileName] = useState<string | undefined>(undefined)
  const [parsed, setParsed] = useState<ParsedCsv | undefined>(undefined)
  const [fileProblem, setFileProblem] = useState<string | undefined>(undefined)
  const [choices, setChoices] = useState<ReadonlyMap<string, ColumnChoice>>(new Map())
  const [duplicates, setDuplicates] = useState<ReadonlyMap<number, string>>(new Map())
  const [previewProblem, setPreviewProblem] = useState<string | undefined>(undefined)
  const [result, setResult] = useState<ImportCommitted | undefined>(undefined)
  // Regenerated when the attempt in hand ends - a new file, or a failure the guard did not
  // cause - so the next commit is an attempt the claim guard has not already granted. What
  // counts as the end of an attempt is `attemptIdAfter`; see `commitSpeakerImportAction`.
  const [attemptId, setAttemptId] = useState(mintAttemptId)
  const [pending, startTransition] = useTransition()

  const rawRows = parsed?.rows ?? []
  const mapped = mapRows(rawRows, mappingFromChoices(choices))
  const preview = dispositions(mapped.rows, duplicates)
  const problems = importProblems(mapped.rejected, result)

  const pick = (picked: File) => {
    const tooBig = uploadSizeMessage(picked.size)
    if (tooBig !== undefined) {
      setParsed(undefined)
      setFileProblem(tooBig)
      return
    }
    // `startTransition(async () => ...)`, not a fire-and-forget promise inside a sync
    // callback: the second shape returns before the work is scheduled, so `pending` is false
    // again in the same tick and every `disabled` below is decorative.
    startTransition(async () => {
      const next = parseCsv(await picked.text())
      if (next.headers.length === 0) {
        setParsed(undefined)
        setFileProblem('There is no header row in that file.')
        return
      }
      // A new file resets everything downstream of it. Keeping the old mapping would point at
      // headers the new file may not have, and keeping the old preview would describe rows
      // that are gone. The submission id is part of "everything downstream": the previous
      // file's id names an attempt the claim guard may still be holding, and reusing it made
      // the second import of a page session fail as `CRM_IMPORT_ALREADY_CLAIMED` about a file
      // nobody had submitted.
      setFileProblem(undefined)
      setFileName(picked.name)
      setParsed(next)
      setChoices(choicesFromMapping(next.headers, autoMapHeaders(next.headers)))
      setDuplicates(new Map())
      setPreviewProblem(undefined)
      setResult(undefined)
      setAttemptId((current) => attemptIdAfter({ kind: 'file' }, current, mintAttemptId))
    })
  }

  /**
   * Ask the server which rows collide, on arrival at the preview step.
   *
   * Only row numbers and addresses are sent, and the answer names no record: it is `existing`
   * or `row:<n>`. Best effort by design. If it fails, the preview says so and the import stays
   * available, because the commit matches on email itself and cannot duplicate anybody for
   * want of a preview.
   *
   * The failure path does not fall back to "everything is new". Half of what this answers is
   * a question about the organizer's OWN FILE - which rows repeat an earlier row - and that
   * half needs no server at all: `findDuplicates` against an empty existing set is exactly the
   * within-file rule, and it is the half with a consequence, because `dedupeRows` will drop
   * those rows whether or not the preview managed to say so.
   */
  const check = (rows: readonly SpeakerImportRow[]) => {
    // Cleared BEFORE the round trip, not replaced after it. Re-entering Preview with a changed
    // mapping otherwise renders the previous mapping's badges against the new rows for as long
    // as the request takes, and a row badged `Update` from a stale answer is exactly the
    // preview-versus-commit disagreement this step exists to prevent. `Checking...` in the
    // column head says why the badges are absent.
    setDuplicates(new Map())
    startTransition(async () => {
      const answer = await previewSpeakerImportAction({
        rows: rows.map((row) => ({ rowNumber: row.rowNumber, email: row.email })),
      })
      if (!answer.ok) {
        setDuplicates(findDuplicates(rows, []))
        setPreviewProblem(answer.message)
        return
      }
      setPreviewProblem(undefined)
      setDuplicates(new Map(answer.duplicates))
    })
  }

  const go = (id: string) => {
    setCurrent(id)
    // Re-checked on every arrival rather than once: the organizer can go back, remap the email
    // column and return, and a preview computed against the old mapping would be a lie.
    if (id === 'preview') check(mapped.rows)
  }

  const commit = () => {
    startTransition(async () => {
      const answer = await commitSpeakerImportAction({
        submissionId: attemptId,
        eventId,
        rows: mapped.rows,
      })
      if (!answer.ok) {
        // A fresh attempt id for a genuine failure, so a retry is a new attempt the claim
        // guard has not seen - and NOT for the guard's own refusal, which the rule in
        // `attemptIdAfter` decides and `tests/crm-import-wizard-state.test.ts` pins.
        setAttemptId((current) =>
          attemptIdAfter({ kind: 'failure', errorId: answer.errorId }, current, mintAttemptId),
        )
        toast.error(answer.message)
        return
      }
      setResult({ summary: answer.summary, skipped: answer.skipped })
      toast.success('Saved successfully')
    })
  }

  const downloadReport = () => {
    const rawByRow = new Map(rawRows.map((row, index) => [fileRowNumber(index), row] as const))
    downloadCsv('speaker-import-errors.csv', buildErrorCsv(importErrorRows(problems, rawByRow)))
  }

  const gateState: ImportWizardState = {
    parsed: parsed === undefined ? undefined : { rowCount: parsed.rows.length },
    choices,
    mapped,
  }

  return (
    <StepWizard
      steps={IMPORT_STEPS}
      current={current}
      onCurrentChange={go}
      gate={{ mode: 'gated', completed: completedImportSteps(gateState) }}
      busy={pending}
      blockers={stepBlockers(current, gateState)}
      label="IMPORT"
      ariaLabel="Import steps"
      finalAction={
        // Withdrawn once the import has landed: the receipt is not a form to submit again,
        // and the claim guard would refuse this attempt anyway.
        result !== undefined ? null : (
          <Button disabled={pending} onClick={commit}>
            {pending ? 'Importing...' : 'Import'}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-semibold">
            {STEP_TITLES.get(current)?.title}
          </h2>
          <p className="text-sm text-muted-foreground">{STEP_TITLES.get(current)?.description}</p>
        </div>
        <ImportStepBody
          step={current}
          events={events}
          eventId={eventId}
          eventName={events.find((event) => event.id === eventId)?.name ?? ''}
          onEventChange={setEventId}
          fileName={fileName}
          parsed={parsed}
          onPick={pick}
          fileProblem={fileProblem}
          choices={choices}
          onChoose={(header, choice) => setChoices(chooseColumn(choices, header, choice))}
          mapped={mapped}
          preview={preview}
          previewProblem={previewProblem}
          result={result}
          onDownloadReport={downloadReport}
          reportable={problems.length > 0}
          busy={pending}
        />
      </div>
    </StepWizard>
  )
}

/**
 * Every row worth putting in the downloadable report, from both sides of the commit: what the
 * mapping refused here, what the write refused there, and what was dropped as a repeat. One
 * file, because an organizer fixing a spreadsheet wants one list of lines to look at.
 */
function importProblems(
  rejected: readonly { readonly rowNumber: number; readonly reason: string }[],
  result: ImportCommitted | undefined,
): readonly ImportProblem[] {
  return [
    ...rejected.map((row) => ({ rowNumber: row.rowNumber, field: 'email', reason: row.reason })),
    ...(result?.summary.failures ?? []).map((failure) => ({
      rowNumber: failure.rowNumber,
      field: 'row',
      reason: failure.reason,
    })),
    ...(result?.skipped ?? []).map((rowNumber) => ({
      rowNumber,
      field: 'email',
      reason: 'Repeats an email earlier in this file',
    })),
  ]
}
