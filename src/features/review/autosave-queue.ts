// Debounced autosave, as a state machine with the timer injected.
//
// BUILD_SPEC 3.1 is unambiguous about why this exists: Airtable allows roughly five
// requests per second per base, and "an autosaving review form firing on every
// keystroke will hit that ceiling and start returning 429". So scoring coalesces to
// one write per ~800ms, and the save state and any failure are visible rather than a
// score silently disappearing.
//
// The timer is a dependency instead of `setTimeout` so this is testable with a manual
// clock. Debounce bugs are all timing bugs, and a test that has to sleep is a test
// that will be deleted the first time it flakes.

export const AUTOSAVE_DELAY_MS = 800

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export type AutosaveState = {
  readonly status: AutosaveStatus
  /** Present only for `error`. Shown next to the field, never swallowed. */
  readonly message?: string
}

/** Cancels a scheduled callback. Returned by `schedule` so the queue can reschedule. */
export type CancelTimer = () => void

export type AutosaveQueueOptions<TDraft> = {
  /** Coalesces two patches that arrive inside one debounce window. */
  readonly merge: (current: TDraft, patch: Partial<TDraft>) => TDraft
  readonly save: (draft: TDraft) => Promise<void>
  readonly onState: (state: AutosaveState) => void
  readonly onDraft?: (draft: TDraft) => void
  readonly schedule: (run: () => void, delayMs: number) => CancelTimer
  readonly delayMs?: number
}

export type AutosaveQueue<TDraft> = {
  /** Record an edit. Restarts the debounce window. */
  readonly change: (patch: Partial<TDraft>) => void
  /** Save now, skipping the wait. The Save-and-next key path uses this. */
  readonly flush: () => Promise<void>
  readonly draft: () => TDraft
  readonly cancel: () => void
}

export function createAutosaveQueue<TDraft>(
  initial: TDraft,
  options: AutosaveQueueOptions<TDraft>,
): AutosaveQueue<TDraft> {
  const delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS
  let draft = initial
  let cancelTimer: CancelTimer | undefined
  let inFlight: Promise<void> | undefined

  /**
   * A version counter rather than a dirty flag.
   *
   * A flag cannot answer the question that matters: an edit that lands WHILE a save is in
   * flight has to be saved afterwards, but the save that is completing must not clear it.
   * With versions, a completed save records which version it stored, and the two facts
   * ("something changed" and "what was stored") stop competing for one boolean. Without
   * this, the last keystroke before a slow save completes is dropped and the indicator
   * still reads "Saved" for a value that was never sent.
   */
  let version = 0
  let savedVersion = 0

  const clear = () => {
    cancelTimer?.()
    cancelTimer = undefined
  }

  const run = async (): Promise<void> => {
    clear()
    // Already saving: join it rather than starting a second write against the same row.
    // The tail of the in-flight run picks up anything newer.
    if (inFlight !== undefined) {
      await inFlight
      return
    }
    // Nothing new since the last successful save, so pressing Save is a no-op instead of
    // a redundant request against a five-per-second budget.
    if (version === savedVersion) return

    const attempt = version
    const payload = draft
    options.onState({ status: 'saving' })

    inFlight = (async () => {
      try {
        await options.save(payload)
        savedVersion = attempt
        options.onState({ status: 'saved' })
      } catch (error) {
        // Surfaced and left dirty, never retried automatically: a failing write retried
        // every 800ms is how one broken save becomes the thing that exhausts the rate
        // budget. The reviewer retries with the Save button.
        options.onState({ status: 'error', message: describe(error) })
      }
    })()

    try {
      await inFlight
    } finally {
      inFlight = undefined
    }

    // Chase a newer version only if this attempt actually landed. Recursing after a
    // failure is the loop the comment above rules out.
    if (savedVersion === attempt && version !== savedVersion) {
      await run()
    }
  }

  return {
    change: (patch) => {
      draft = options.merge(draft, patch)
      version += 1
      options.onDraft?.(draft)
      options.onState({ status: 'pending' })
      clear()
      cancelTimer = options.schedule(() => {
        void run()
      }, delayMs)
    },
    flush: async () => {
      await run()
    },
    draft: () => draft,
    cancel: clear,
  }
}

/** Reviewers get the reason, not "something went wrong". */
function describe(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return 'Save failed. Your last change was not stored.'
}

/**
 * A Map rather than a record, and read through the function below, because
 * `security/detect-object-injection` treats any computed index into a plain object as a
 * sink and that warning fails this build.
 */
const AUTOSAVE_LABELS: ReadonlyMap<AutosaveStatus, string> = new Map([
  ['idle', ''],
  ['pending', 'Unsaved changes'],
  ['saving', 'Saving...'],
  ['saved', 'Saved'],
  ['error', 'Not saved'],
])

export function autosaveLabel(status: AutosaveStatus): string {
  return AUTOSAVE_LABELS.get(status) ?? ''
}
