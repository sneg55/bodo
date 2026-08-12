'use client'

// The import wizard, on the shared `StepWizard`. BUILD_SPEC 5.0e, "Surface".
//
// `mode: 'gated'`, because this CREATES rather than edits. The form editor's rail is free
// since every step of a record that already exists is reachable; a half-built import is not
// a record anybody should be able to skip to the end of, and the end of this one writes the
// whole event.
//
// THE `source` STEP IS NOT RENDERED and is not built. 5.0e lists it first and then says it
// is "skipped when entered from a provider row, since the row names it". Every way in here
// is a provider row, because the source is a path segment on this route, so the step would
// only ever ask a question the URL already answered. See `wizard-steps.ts`.
//
// THE PREVIEW IS A SERVER ROUND TRIP THAT SURVIVES A STEP CHANGE, which is exactly why
// `StepWizard` is controlled and the step lives here. It is re-fetched when, and only when,
// the request it describes changes: `previewKey` is the far-side identity plus the confirmed
// category mapping, so walking back to fix an endpoint id refetches and walking back to
// re-read a warning does not.
//
// NOTHING IS WRITTEN UNTIL `Import`. Every call before that is a read of the far side plus
// this event's `IntegrationMappings`, and the first call that can create a row is
// `startImportAction`.

import Link from 'next/link'
import { useState, useTransition } from 'react'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { StepWizard, type StepWizardStep } from '@/components/primitives/StepWizard'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { previewImportAction } from '@/features/imports/actions'
import {
  completedImportSteps,
  EMPTY_IMPORT_CREDENTIALS,
  type ImportCredentials,
  type ImportWizardStepId,
  importWizardSteps,
  sourceRefFor,
} from '@/features/imports/wizard-steps'
import type { ImportSource } from '@/types/imports'
import { EMPTY_IMPORT_MAPPING, type ImportMapping, type ImportPreview } from '@/types/imports'

import { CredentialsStep } from './CredentialsStep'
import { MappingStep } from './MappingStep'
import { PreviewStep } from './PreviewStep'
import { RunStep, reportRun } from './RunStep'
import { useImportRun } from './use-import-run'

export type ImportWizardProps = {
  eventId: string
  source: ImportSource
  providerLabel: string
  /** Accelevents `<eventId>:<eventUrl>` off the event record. Empty when never mapped. */
  acceleventsRef: string
  backHref: string
}

export function ImportWizard({
  eventId,
  source,
  providerLabel,
  acceleventsRef,
  backHref,
}: ImportWizardProps) {
  const [step, setStep] = useState<ImportWizardStepId>('credentials')
  const [credentials, setCredentials] = useState<ImportCredentials>({
    ...EMPTY_IMPORT_CREDENTIALS,
    acceleventsRef,
  })
  const [mapping, setMapping] = useState<ImportMapping>(EMPTY_IMPORT_MAPPING)
  const [preview, setPreview] = useState<ImportPreview | undefined>(undefined)
  const [previewError, setPreviewError] = useState<string | undefined>(undefined)
  const [loadedKey, setLoadedKey] = useState('')
  const [loading, startPreview] = useTransition()
  const run = useImportRun()

  const steps: readonly StepWizardStep[] = importWizardSteps(source)
  const sourceRef = sourceRefFor(source, credentials)
  const token = credentials.token.trim() === '' ? undefined : credentials.token
  // What the preview would describe if it were fetched now. Compared against what was
  // fetched, so a step change costs a round trip only when the request actually changed.
  const previewKey =
    sourceRef === undefined ? '' : `${sourceRef}|${JSON.stringify(mapping.categories)}`

  const completed = completedImportSteps({
    source,
    credentials,
    mapping,
    categories: preview?.categories ?? [],
    categoriesKnown: preview !== undefined,
    started: run.state.runId !== undefined,
  })

  const loadPreview = (): void => {
    if (sourceRef === undefined) return
    const key = previewKey
    setPreviewError(undefined)
    startPreview(async () => {
      const result = await previewImportAction({
        eventId,
        source,
        sourceRef,
        mapping,
        sessionboardToken: token,
      })
      // Recorded either way, so a refused dry run does not re-fire on every re-render of
      // the step it failed on. Pressing Try again is what asks for it a second time.
      setLoadedKey(key)
      if (!result.ok) {
        setPreviewError(result.message)
        return
      }
      setPreview(result.preview)
    })
  }

  const goTo = (next: string): void => {
    setStep(next as ImportWizardStepId)
    // The mapping step needs the categories the dry run discovers, and the preview step is
    // the dry run, so both pull. The run step never does: by then the request is a row.
    if ((next === 'mapping' || next === 'preview') && loadedKey !== previewKey) loadPreview()
  }

  const startImport = (): void => {
    if (sourceRef === undefined) return
    setStep('run')
    void run
      .start({ eventId, source, sourceRef, mapping, sessionboardToken: token })
      .then(reportRun)
  }

  const busy = loading || run.state.busy

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        {/* `h2`, like every other settings page: the layout above already renders the `h1`
            ("Event Settings"), and a second one is two top-level headings for a screen
            reader to choose between. */}
        <h2 className="font-heading text-lg font-semibold">{`Import from ${providerLabel}`}</h2>
        <p className="text-sm text-muted-foreground">
          A one-way pull. It reads {providerLabel} and writes into this event, updating what a
          previous import created and creating what is new. It never deletes anything here and never
          writes anything back to {providerLabel}.
        </p>
      </div>

      <StepWizard
        steps={steps}
        current={step}
        onCurrentChange={goTo}
        gate={{ mode: 'gated', completed }}
        label="IMPORT"
        ariaLabel="Import steps"
        secondaryAction={
          <ButtonLink href={backHref} variant="ghost">
            Cancel
          </ButtonLink>
        }
        finalAction={
          busy ? (
            <Button disabled>Working...</Button>
          ) : (
            <ButtonLink href={backHref}>Back to Integrations</ButtonLink>
          )
        }
      >
        {step === 'credentials' && (
          <CredentialsStep
            eventId={eventId}
            source={source}
            credentials={credentials}
            onChange={setCredentials}
            disabled={busy}
          />
        )}

        {step === 'mapping' &&
          (previewError === undefined ? (
            <MappingStep
              categories={preview?.categories ?? []}
              known={preview !== undefined && !loading}
              mapping={mapping}
              onChange={setMapping}
              disabled={busy}
            />
          ) : (
            <StepError message={previewError} onRetry={loadPreview} disabled={busy} />
          ))}

        {step === 'preview' && (
          <PreviewStep
            preview={preview}
            providerLabel={providerLabel}
            loading={loading}
            error={previewError}
            onRetry={loadPreview}
            onImport={startImport}
            cancelHref={backHref}
            disabled={busy}
          />
        )}

        {step === 'run' && <RunStep eventId={eventId} source={source} state={run.state} />}
      </StepWizard>
    </div>
  )
}

/** A refused dry run on a step whose whole content depends on it. */
function StepError({
  message,
  onRetry,
  disabled,
}: {
  message: string
  onRetry: () => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="destructive">
        <AlertTitle>Nothing was read, and nothing was written</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Button variant="outline" onClick={onRetry} disabled={disabled}>
        Try again
      </Button>
    </div>
  )
}
