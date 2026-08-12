// What each toolbar button IS: its label, its icon, the name `isActive` is asked about,
// and the command it runs. Split out of RichTextEditorToolbar.tsx so that file is markup
// and this one is the inventory, and so neither passes the 300-line limit.
//
// The order of MARKS, LISTS and ALIGNMENTS is the order the buttons render in, and it is
// the reference toolbar's order (docs/parity/submission-form-builder.md ref 83).

import type { Editor } from '@tiptap/react'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  type LucideIcon,
  SubscriptIcon,
  SuperscriptIcon,
  UnderlineIcon,
} from 'lucide-react'

import { safeHttpUrl } from '@/components/primitives/rich-text-html'

export type Toggleable = {
  label: string
  icon: LucideIcon
  /** The mark or node name `isActive` is asked about, and the key in the active set. */
  name: string
  run: (editor: Editor) => void
}

/** Bold through subscript. Superscript and subscript are the two newly installed marks. */
export const MARKS: readonly Toggleable[] = [
  { label: 'Bold', icon: BoldIcon, name: 'bold', run: (e) => e.chain().focus().toggleBold().run() },
  {
    label: 'Italic',
    icon: ItalicIcon,
    name: 'italic',
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: 'Underline',
    icon: UnderlineIcon,
    name: 'underline',
    run: (e) => e.chain().focus().toggleUnderline().run(),
  },
  {
    label: 'Superscript',
    icon: SuperscriptIcon,
    name: 'superscript',
    run: (e) => e.chain().focus().toggleSuperscript().run(),
  },
  {
    label: 'Subscript',
    icon: SubscriptIcon,
    name: 'subscript',
    run: (e) => e.chain().focus().toggleSubscript().run(),
  },
]

export const LISTS: readonly Toggleable[] = [
  {
    label: 'Bulleted list',
    icon: ListIcon,
    name: 'bulletList',
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Numbered list',
    icon: ListOrderedIcon,
    name: 'orderedList',
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
]

export const ALIGNMENTS: readonly { label: string; icon: LucideIcon; value: string }[] = [
  { label: 'Align left', icon: AlignLeftIcon, value: 'left' },
  { label: 'Align center', icon: AlignCenterIcon, value: 'center' },
  { label: 'Align right', icon: AlignRightIcon, value: 'right' },
]

/**
 * Items behind `...`. The reference shows the trigger with its menu CLOSED, so the
 * contents are inferred rather than transcribed, and they are limited to formatting the
 * StarterKit schema already supports.
 */
export const OVERFLOW: readonly { label: string; run: (editor: Editor) => void }[] = [
  { label: 'Strikethrough', run: (e) => e.chain().focus().toggleStrike().run() },
  { label: 'Block quote', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: 'Horizontal rule', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { label: 'Clear formatting', run: (e) => e.chain().focus().unsetAllMarks().clearNodes().run() },
]

const BLOCK_TAGS = new Map<string, string>([
  ['paragraph', 'p'],
  ['bulletList', 'ul'],
  ['orderedList', 'ol'],
  ['listItem', 'li'],
  ['blockquote', 'blockquote'],
  ['codeBlock', 'pre'],
])

/**
 * Everything the toolbar draws as pressed, as a flat list of names.
 *
 * A list rather than a keyed object because it is compared by `useEditorState`'s deep
 * equality on every transaction, and because `includes` at the call site avoids indexing
 * an array by a loop variable.
 */
export function activeNames(editor: Editor): readonly string[] {
  const names = [...MARKS, ...LISTS]
    .map((item) => item.name)
    .filter((name) => editor.isActive(name))
  if (editor.isActive('link')) names.push('link')
  for (const alignment of ALIGNMENTS) {
    if (editor.isActive({ textAlign: alignment.value })) names.push(`align:${alignment.value}`)
  }
  return names
}

/** The tag of the innermost block the caret sits in, for the status bar indicator. */
export function blockTagOf(editor: Editor): string {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'heading') {
      const level: unknown = node.attrs.level
      return typeof level === 'number' ? `h${String(level)}` : 'h1'
    }
    const tag = BLOCK_TAGS.get(node.type.name)
    if (tag !== undefined) return tag
  }
  return 'p'
}

/**
 * Indents. Inside a list that means nesting the item, which is `sinkListItem`, a CORE
 * command; anywhere else it is a left margin, which is the local BlockIndent extension
 * (rich-text-indent.ts explains why local).
 *
 * The list command runs first, but whether we are IN a list is asked separately rather than
 * inferred from whether it applied. Those are different questions, and conflating them was a
 * real bug found by Codex review: `sinkListItem` returns false for the FIRST item of a list,
 * because it has no preceding sibling to nest under. Treating that false as "not in a list" ran
 * the block fallback, which found the paragraph inside the list item and gave it a margin, so
 * the first bullet got a stray internal indent where the correct answer is to do nothing.
 */
export function indent(editor: Editor | null): void {
  if (editor === null) return
  if (editor.isActive('listItem')) {
    // A failed sink here is a legitimate no-op, not a signal to try something else.
    editor.chain().focus().sinkListItem('listItem').run()
    return
  }
  editor.chain().focus().indentBlock().run()
}

/** The mirror of `indent`, and the same distinction: in a list, lifting is the whole answer. */
export function outdent(editor: Editor | null): void {
  if (editor === null) return
  if (editor.isActive('listItem')) {
    editor.chain().focus().liftListItem('listItem').run()
    return
  }
  editor.chain().focus().outdentBlock().run()
}

/**
 * Turns the selected text into a link, or removes one.
 *
 * The href comes from the selection, so there is no dialog to build. `safeHttpUrl` is why
 * only http and https get through: a `javascript:` href stored in a welcome message is a
 * script running in the visitor's browser on the public form.
 */
export function toggleLink(editor: Editor | null): void {
  if (editor === null) return
  if (editor.isActive('link')) {
    editor.chain().focus().unsetLink().run()
    return
  }
  const { from, to } = editor.state.selection
  const href = safeHttpUrl(editor.state.doc.textBetween(from, to))
  if (href === undefined) return
  editor.chain().focus().setLink({ href }).run()
}
