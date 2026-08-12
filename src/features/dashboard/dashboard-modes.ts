// The mode tabs the New Dashboard modal carries, ref 40: `Gallery` and `AI prompt`.
//
// **Ref 40's third tab, `Build manually`, is not one of them, and neither modal has a tab that
// leads nowhere any more.** Both panes behind it were a line saying the mode is not built, on a
// tab that was not disabled, so the only way to find that out was to click. It is dropped rather
// than kept as a stub: an empty-dashboard builder is a whole uncaptured flow, so SPEC.md line 55's
// build-the-interior exception does not reach it, and there is nothing to put behind the tab. The
// Add Widget modal has no strip at all now, because only its gallery pane ever had contents.
// Recorded here rather than silently dropped, same as the label divergence below.
//
// **A recorded divergence.** Ref 40 is the New Dashboard modal and these are its labels,
// transcribed. The CURRENT product's Add Widget modal reads `Gallery` / `From report` /
// `Build custom` instead (docs/parity/external-references.md, "Custom dashboards, widgets, and
// the Add Widget modal", off a screen recording), and its `From report` pane holds a
// `Search reports...` input, a `Report` select and a `Visualization type` select. Our own
// screenshots win on presentation (CLAUDE.md, precedence by domain), so these are the labels
// used, and the newer labels are not adopted. They are recorded here rather than
// silently dropped because they are evidence that the surface moved after our capture, and
// because `From report` implies the widget data model our schema deliberately does not have:
// upstream a widget points at a saved report, ours points at one of eight fixed metrics.
//
// Data-only, with no icons and no JSX, so the modal and its icon map read one list and cannot
// drift the labels or their order. The labels are pinned in tests/dashboards-templates.test.ts,
// because a label IS the parity target here.

export const DASHBOARD_MODES = [
  { id: 'gallery', label: 'Gallery' },
  { id: 'ai', label: 'AI prompt' },
] as const

export type DashboardMode = (typeof DASHBOARD_MODES)[number]['id']

/** Ref 40's mode tab that is selected when the modal opens. */
export const DEFAULT_DASHBOARD_MODE: DashboardMode = 'gallery'

/** Ref 40's subtitle, under the `New Dashboard` title. */
export const NEW_DASHBOARD_SUBTITLE =
  'Start from a pre-built dashboard, describe what you want, or build one manually.'
