// What a builder check reports, in its own module so the check modules can share it
// without importing each other. `checks.ts` re-exports the type, which is where every
// caller already gets it from.

export type BuilderProblem = {
  severity: 'error' | 'warning'
  /** Which step of the wizard to send the organizer to. */
  step: number
  message: string
  fieldId?: string
  /**
   * A warning that must not reach a speaker: it refuses PUBLISH while still allowing SAVE.
   *
   * The third state exists because the two that were here could not say this. An `error`
   * refuses the save, which is what made a form on an event with no categories unsaveable
   * from birth (the CFP-01 finding) and is why the option checks were softened to warnings.
   * A `warning` refuses nothing, so a form offering options its column cannot store went
   * public and every answer to those options was dropped, silently, weeks later. That is
   * the CFP-15 twin: the organizer was told, in a warning they could publish straight past.
   *
   * Publishing is the right gate for it, because publishing is the moment a half-built form
   * becomes something a stranger submits through. Set it on any problem where the form is
   * still worth keeping as a draft but an answer to it would be lost.
   */
  blocksPublish?: boolean
}
