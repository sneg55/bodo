// The steps of the editor rail, verbatim off the screenshots (parity refs 06-15), less the
// Payments & Fees step the organizer stickered NOT NEEDED. Six of the product's seven.
//
// Titles and subtitles are the product's own wording and are not to be improved:
// familiarity is a scored axis. Step 3's title tracks the submission type chosen on step
// 1, which is what the parity doc infers from the step being called "Abstract
// Information" on an abstracts form.

import {
  BellIcon,
  ClipboardListIcon,
  type LucideIcon,
  MessageSquareIcon,
  SettingsIcon,
  UsersIcon,
} from 'lucide-react'

import type { FormEntityKind } from '@/constants/status'

export type EditorStep = {
  /** 1-based, so it reads the same here as in the parity doc and in a problem message. */
  index: number
  title: string
  subtitle: string
  icon: LucideIcon
}

/** Six now that Payments is gone, and the highest index is still 7. Nothing derives one
 * from the other, which is why the constant is stated rather than computed. */
export const EDITOR_STEP_COUNT = 6

export function editorSteps(entityKind: FormEntityKind): readonly EditorStep[] {
  return [
    {
      index: 1,
      title: 'Submission Setup',
      subtitle: 'Submission type and participants',
      icon: ClipboardListIcon,
    },
    {
      index: 2,
      title: 'Welcome Screen',
      subtitle: 'Welcome message and terms',
      icon: MessageSquareIcon,
    },
    {
      index: 3,
      title: entityKind === 'sessions' ? 'Session Information' : 'Abstract Information',
      subtitle: 'Session or abstract questions',
      icon: ClipboardListIcon,
    },
    {
      index: 4,
      title: 'Participant Information',
      subtitle: 'Participant and contact fields',
      icon: UsersIcon,
    },
    // Index 5 was Payments & Fees. BUILD_SPEC 5.1 offered a choice for the step the
    // organizer stickered NOT NEEDED, "render the step disabled with a not-in-scope note, or
    // omit it", and the second option was taken on request 2026-08-09.
    //
    // The indices of the two steps after it deliberately do NOT shift down. Nothing renders
    // the number (`EditorRail` draws an icon, a title and a subtitle), so the gap is
    // invisible, while renumbering would put every "step 6" and "step 7" in this directory
    // and in docs/parity/submission-form-builder.md one out from the parity refs they cite.
    {
      index: 6,
      title: 'Form Settings',
      subtitle: 'Deadlines, limits, and success page',
      icon: SettingsIcon,
    },
    {
      index: 7,
      title: 'Notifications',
      subtitle: 'Admin alerts and email templates',
      icon: BellIcon,
    },
  ]
}

/**
 * The steps that are actually walkable. Step 4 disappears when the Participants toggle is
 * off, which is what the parity doc says that toggle does: it "adds or removes step 4
 * entirely".
 */
export function visibleSteps(input: {
  entityKind: FormEntityKind
  participantsEnabled: boolean
}): readonly EditorStep[] {
  return editorSteps(input.entityKind).filter(
    (step) => step.index !== 4 || input.participantsEnabled,
  )
}

/** The next or previous walkable step, clamped at both ends. */
export function stepNeighbour(
  steps: readonly EditorStep[],
  current: number,
  delta: number,
): number {
  const order = steps.map((step) => step.index)
  const at = order.indexOf(current)
  return order.at(Math.max(0, Math.min(order.length - 1, at + delta))) ?? current
}
