// Says out loud that this deployment is a demo.
//
// Demo mode puts a one-click sign-in on a public page, so every visitor is the same
// handful of accounts and every edit is visible to the next person through the door.
// Someone who arrived from a link has no way to know that, and the surfaces above look
// exactly like the real product, which is the point of a demo and also the hazard: the
// consequence of a delete is not what it appears to be. This is the one place that
// difference is stated.
//
// Self-gating, returning null when demo mode is off, so a layout renders it
// unconditionally and no call site repeats the check or drifts out of step with it.
//
// A server component: `isDemoMode()` reads the env boundary, which is server-only.

import { isDemoMode } from '@/utils/env'

export function DemoBanner() {
  if (!isDemoMode()) return null

  return (
    <div
      // A live region rather than a bare div: a screen reader user is exactly the
      // visitor least likely to have inferred any of this from the layout.
      role="status"
      // `--status-pending` and not `destructive`: this is a caution, not an error
      // the visitor should act on. It used to name amber directly, because the
      // token layer had no colour that meant caution. It does now, and it is the
      // same one the Pending chip uses.
      className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-b border-status-pending/40 bg-status-pending/10 px-3 py-1.5 text-center text-xs text-status-pending"
    >
      <span className="meta">Demo</span>
      <span className="opacity-80">
        Shared sign-in and shared data. Anything you change here is visible to everyone else, and
        may be reset at any time.
      </span>
    </div>
  )
}
