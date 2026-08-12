// Indent and outdent for blocks that are not list items, as a LOCAL TipTap extension.
//
// Why local. The reference toolbar has an outdent/indent pair next to the two list
// buttons (docs/parity/submission-form-builder.md ref 83, portal-tasks-forms.md refs 89
// and 121), and inside a list that pair is `sinkListItem` and `liftListItem`, which are
// core commands and need nothing installed. On a plain paragraph it is a left margin, and
// there is NO official `@tiptap/extension-indent`: the name 404s on the registry. So the
// paragraph half is 60 lines here rather than a dependency, and the toolbar tries the list
// command first and falls back to these (see RichTextEditorToolbar).
//
// The attribute is a level, not a margin. Storing `indent: 2` and rendering
// `margin-left: 3rem` keeps the step in one place and keeps the clamp meaningful; the
// serialisation both ways is in rich-text-html.ts, which is where it gets unit tested.

import { type CommandProps, Extension } from '@tiptap/core'

import {
  clampIndent,
  indentLevelFromStyle,
  indentStyle,
} from '@/components/primitives/rich-text-html'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockIndent: {
      /** Indents every block in the selection one step, up to `MAX_INDENT_LEVEL`. */
      indentBlock: () => ReturnType
      /** Outdents every block in the selection one step, stopping at zero. */
      outdentBlock: () => ReturnType
    }
  }
}

export type BlockIndentOptions = {
  /** Node types that carry the attribute. Lists are excluded: they sink and lift instead. */
  types: readonly string[]
}

export const BlockIndent = Extension.create<BlockIndentOptions>({
  name: 'blockIndent',

  addOptions() {
    return { types: ['paragraph', 'heading'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: [...this.options.types],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element: HTMLElement) => indentLevelFromStyle(element.style.marginLeft),
            // `mergeAttributes` merges `style` property by property, so this coexists with
            // the `text-align` TextAlign puts on the same node.
            renderHTML: (attributes: Record<string, unknown>) => {
              const style = indentStyle(readLevel(attributes.indent))
              return style === undefined ? {} : { style }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    const { types } = this.options
    return {
      indentBlock:
        () =>
        (props): boolean =>
          shiftIndent(props, 1, types),
      outdentBlock:
        () =>
        (props): boolean =>
          shiftIndent(props, -1, types),
    }
  },
})

/** ProseMirror attributes are `any`, so the level is narrowed before it is arithmetic. */
function readLevel(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

/**
 * Moves every indentable block touched by the selection one step.
 *
 * Positions taken from `state.doc` stay valid while the transaction runs because
 * `setNodeMarkup` changes attributes only: no node changes size, so nothing after it
 * moves. Returns whether anything would change, which is what makes the toolbar's
 * "try the list command first" fallback able to tell the two cases apart.
 */
function shiftIndent(
  { tr, state, dispatch }: CommandProps,
  delta: number,
  types: readonly string[],
): boolean {
  const { from, to } = state.selection
  let changed = false

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!types.includes(node.type.name)) return true
    const current = clampIndent(readLevel(node.attrs.indent))
    const next = clampIndent(current + delta)
    if (next === current) return true
    changed = true
    if (dispatch !== undefined) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
    return true
  })

  return changed
}
