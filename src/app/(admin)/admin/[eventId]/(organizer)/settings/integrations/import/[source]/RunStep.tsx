'use client'

// The wizard's last step: progress, the stall notice where it applies, then Needs-email.
//
// Split out of `ImportWizard` because this is the half of the screen an organizer comes
// back to after the run, and because the wizard shell is about navigation while this is
// about an outcome. It reads state and renders; it starts nothing.
//
// THE STALL NOTICE IS SESSIONBOARD'S ALONE. That source is the only one whose run nothing
// else can pick up: the cron sweep holds no organization token, because there is
// deliberately no credential column on `ImportRuns`, so it reports `no-client` and leaves
// the row `running` with a lapsed lease. A run that stops short here is therefore stopped
// until a human starts a new one, and saying nothing would leave an organizer waiting on a
// sweep that will keep declining it.

import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { IMPORT_ATTEMPT_MESSAGES } from '@/features/imports/wizard-steps'
import type { ImportSource } from '@/types/imports'

import { NeedsEmailList } from './NeedsEmailList'
import { RunProgress } from './RunProgress'
import type { ImportRunState } from './use-import-run'

const SESSIONBOARD_STALLED =
  'The scheduled sweep cannot carry a Sessionboard run on, because it holds no token. Start the import again from the Integrations page to finish it.'

/**
 * One toast per run, written from how the LAST call ended rather than from the row.
 *
 * Three outcomes, not two. A run that neither finished nor failed was handed to somebody
 * else or ran out of credential, and a green toast over that is how an unfinished import
 * goes unnoticed until an organizer wonders where half their sessions are.
 */
export function reportRun(final: ImportRunState): void {
  const text = IMPORT_ATTEMPT_MESSAGES.get(final.attempt ?? '')
  if (final.status === 'done') {
    toast.success(text ?? 'Import finished.')
    return
  }
  if (final.status === 'failed') {
    toast.error(final.error ?? text ?? 'The import failed.')
    return
  }
  toast.warning(text ?? 'The import did not finish.')
}

export function RunStep({
  eventId,
  source,
  state,
}: {
  eventId: string
  source: ImportSource
  state: ImportRunState
}) {
  const stalled = source === 'sessionboard' && !state.busy && state.status === 'running'

  return (
    <div className="flex flex-col gap-5">
      <RunProgress
        status={state.status}
        phasesDone={state.phasesDone}
        counts={state.counts}
        busy={state.busy}
        error={state.error}
        message={IMPORT_ATTEMPT_MESSAGES.get(state.attempt ?? '')}
      />

      {stalled && (
        <Alert>
          <AlertTitle>This run needs the token to go any further</AlertTitle>
          <AlertDescription>{SESSIONBOARD_STALLED}</AlertDescription>
        </Alert>
      )}

      <NeedsEmailList eventId={eventId} rows={state.needsEmail} />
    </div>
  )
}
