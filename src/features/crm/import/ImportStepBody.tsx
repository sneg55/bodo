'use client'

// Which step body the wizard is showing.
//
// Its own component, and its own file, for one reason: with the four bodies inline the wizard
// tripped ESLint's complexity ceiling (21 against 15), and the honest fix is that "which step
// renders" is a separate decision from "what the wizard is holding". Everything here is
// presentational; every value it takes is owned by `ImportWizard`.

import type { ImportCommitted } from '@/features/crm/import/actions'
import type { ParsedCsv } from '@/features/crm/import/csv-parse'
import { ImportCommitStep } from '@/features/crm/import/ImportCommitStep'
import { ImportMapStep } from '@/features/crm/import/ImportMapStep'
import { ImportPreviewStep } from '@/features/crm/import/ImportPreviewStep'
import { type ImportEventOption, ImportUploadStep } from '@/features/crm/import/ImportUploadStep'
import type { ColumnChoice, MappedRows, RowDisposition } from '@/features/crm/import/wizard-state'

export type ImportStepBodyProps = {
  step: string
  events: readonly ImportEventOption[]
  eventId: string
  eventName: string
  onEventChange: (eventId: string) => void

  fileName: string | undefined
  parsed: ParsedCsv | undefined
  onPick: (file: File) => void
  fileProblem: string | undefined

  choices: ReadonlyMap<string, ColumnChoice>
  onChoose: (header: string, choice: ColumnChoice) => void

  mapped: MappedRows
  preview: readonly RowDisposition[]
  previewProblem: string | undefined

  result: ImportCommitted | undefined
  onDownloadReport: () => void
  reportable: boolean

  busy: boolean
}

export function ImportStepBody(props: ImportStepBodyProps) {
  if (props.step === 'upload') {
    return (
      <ImportUploadStep
        events={props.events}
        eventId={props.eventId}
        onEventChange={props.onEventChange}
        file={
          props.parsed === undefined || props.fileName === undefined
            ? undefined
            : {
                name: props.fileName,
                rowCount: props.parsed.rows.length,
                columnCount: props.parsed.headers.length,
              }
        }
        onPick={props.onPick}
        problem={props.fileProblem}
        disabled={props.busy}
      />
    )
  }

  if (props.step === 'map') {
    return (
      <ImportMapStep
        headers={props.parsed?.headers ?? []}
        rows={props.parsed?.rows ?? []}
        choices={props.choices}
        onChoose={props.onChoose}
        disabled={props.busy}
      />
    )
  }

  if (props.step === 'preview') {
    return (
      <ImportPreviewStep
        mapped={props.mapped}
        rows={props.preview}
        problem={props.previewProblem}
        checking={props.busy}
      />
    )
  }

  return (
    <ImportCommitStep
      eventName={props.eventName}
      // Repeats are not attempted: `dedupeRows` drops them before the write sees them, so
      // counting them here would promise more rows than the receipt can report.
      plannedCount={props.preview.filter((row) => row.kind !== 'repeat').length}
      result={props.result}
      onDownloadReport={props.onDownloadReport}
      reportable={props.reportable}
    />
  )
}
