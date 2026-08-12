'use client'

// The Biography rich text editor (ref 18).
//
// Toolbar, in the captured order: Bold, Italic, Underline, bulleted list, numbered list,
// align left, align center, align right, link, clear formatting. Placeholder
// `Enter text here...` and a `0 / 5,000 characters` counter underneath.
//
// This module is the DYNAMIC import target, never imported directly by a layout or a
// page: TipTap and ProseMirror are a large bundle and only one surface in the portal
// needs them (BUILD_SPEC 6.3, and .claude/rules/bodo-conventions.md says so explicitly).
// `BiographyEditor` is what does the `next/dynamic` call.
//
// The value crosses to the server through a hidden field rather than through React
// state, because the profile form is a plain `<form action={...}>`: TipTap owns a
// contentEditable node that posts nothing by itself, so without the mirror a speaker's
// biography would never reach the action.

import TextAlign from '@tiptap/extension-text-align'
import { Placeholder } from '@tiptap/extensions'
import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  RemoveFormattingIcon,
  UnderlineIcon,
} from 'lucide-react'
import { useState } from 'react'

import { activeNames } from '@/components/primitives/rich-text-commands'
import { safeHttpUrl } from '@/components/primitives/rich-text-html'
import { Input } from '@/components/ui/input'
import { Toggle } from '@/components/ui/toggle'
import { BIO_MAX_LABEL, BIO_MAX_LENGTH, BIO_PLACEHOLDER } from '@/features/portal/profile-form'

export type TipTapEditorProps = {
  name: string
  initialHtml: string
}

export default function TipTapEditor({ name, initialHtml }: TipTapEditorProps) {
  const [html, setHtml] = useState(initialHtml)
  const [length, setLength] = useState(0)

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      // The placeholder is a real extension rather than a CSS `:empty` trick, because
      // ProseMirror always keeps an empty paragraph in the document, so the node is
      // never actually empty and the trick never fires.
      Placeholder.configure({ placeholder: BIO_PLACEHOLDER }),
    ],
    content: initialHtml,
    // Required with SSR: rendering immediately produces markup React did not produce and
    // hydration mismatches on the first keystroke.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // The `is-empty` class and the `data-placeholder` attribute are both set by the
        // Placeholder extension; these two utilities are what actually draw it.
        class:
          'min-h-32 px-3 py-2 text-sm outline-none [&_p]:my-1 [&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
      },
    },
    onCreate: ({ editor: created }) => {
      setLength(created.getText().length)
    },
    onUpdate: ({ editor: updated }) => {
      setHtml(updated.getHTML())
      setLength(updated.getText().length)
    },
  })

  /**
   * Which marks are on at the caret, as a subscription rather than a render-time read.
   *
   * `useEditor` does not re-render on a selection-only transaction, so reading
   * `editor.isActive(...)` during render left every pressed state stale: moving the caret from
   * bold text into plain text kept the B button lit until the next keystroke. The shared
   * `RichTextEditor` had the same bug and was fixed with `useEditorState` in the same pass; this
   * editor is separate, keeps a deliberately smaller button set, and was missed. Found by Codex
   * review. `activeNames` is reused so the two editors cannot disagree about what "on" means.
   */
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => (current === null ? [] : activeNames(current)),
  })
  // `useEditorState` yields null until the editor exists, which is a real frame on first
  // paint, not a defensive guard.
  const on = (name: string): boolean => active?.includes(name) === true

  return (
    <div className="space-y-1.5">
      <div className="overflow-hidden rounded-lg border border-input">
        {/* `hit-area-[30px]` on every toggle and not the full 40. A `sm` toggle is 28px tall
            and 34px wide here (a 14px icon inside `px-2.5`), and the row is `gap-0.5`, so the
            pitch is 30px vertically once the toolbar wraps and 36px across. 30 is the tighter
            of the two, which is what neighbouring targets may grow to and still meet exactly
            rather than cross. */}
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border p-1">
          <Toggle
            size="sm"
            className="hit-area-[30px]"
            pressed={on('bold')}
            onPressedChange={() => editor?.chain().focus().toggleBold().run()}
            aria-label="Bold"
          >
            <BoldIcon />
          </Toggle>
          <Toggle
            size="sm"
            className="hit-area-[30px]"
            pressed={on('italic')}
            onPressedChange={() => editor?.chain().focus().toggleItalic().run()}
            aria-label="Italic"
          >
            <ItalicIcon />
          </Toggle>
          <Toggle
            size="sm"
            className="hit-area-[30px]"
            pressed={on('underline')}
            onPressedChange={() => editor?.chain().focus().toggleUnderline().run()}
            aria-label="Underline"
          >
            <UnderlineIcon />
          </Toggle>
          <Toggle
            size="sm"
            className="hit-area-[30px]"
            pressed={on('bulletList')}
            onPressedChange={() => editor?.chain().focus().toggleBulletList().run()}
            aria-label="Bulleted list"
          >
            <ListIcon />
          </Toggle>
          <Toggle
            size="sm"
            className="hit-area-[30px]"
            pressed={on('orderedList')}
            onPressedChange={() => editor?.chain().focus().toggleOrderedList().run()}
            aria-label="Numbered list"
          >
            <ListOrderedIcon />
          </Toggle>
          <Toggle
            size="sm"
            className="hit-area-[30px]"
            pressed={editor?.isActive({ textAlign: 'left' }) === true}
            onPressedChange={() => editor?.chain().focus().setTextAlign('left').run()}
            aria-label="Align left"
          >
            <AlignLeftIcon />
          </Toggle>
          <Toggle
            size="sm"
            className="hit-area-[30px]"
            pressed={editor?.isActive({ textAlign: 'center' }) === true}
            onPressedChange={() => editor?.chain().focus().setTextAlign('center').run()}
            aria-label="Align center"
          >
            <AlignCenterIcon />
          </Toggle>
          <Toggle
            size="sm"
            className="hit-area-[30px]"
            pressed={editor?.isActive({ textAlign: 'right' }) === true}
            onPressedChange={() => editor?.chain().focus().setTextAlign('right').run()}
            aria-label="Align right"
          >
            <AlignRightIcon />
          </Toggle>
          <Toggle
            size="sm"
            className="hit-area-[30px]"
            pressed={on('link')}
            onPressedChange={() => {
              toggleLink(editor)
            }}
            aria-label="Link"
          >
            <LinkIcon />
          </Toggle>
          <Toggle
            size="sm"
            className="hit-area-[30px]"
            pressed={false}
            onPressedChange={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}
            aria-label="Clear formatting"
          >
            <RemoveFormattingIcon />
          </Toggle>
        </div>
        <EditorContent editor={editor} />
      </div>

      <Input type="hidden" name={name} value={html} readOnly />
      {/* `tabular-nums`: the count recomputes on every keystroke, and proportional digits
          made the whole counter shuffle sideways as it passed 9, 99, 999. */}
      <p className="text-xs tabular-nums text-muted-foreground">
        {`${String(length)} / ${BIO_MAX_LABEL} characters`}
      </p>
      {length > BIO_MAX_LENGTH ? (
        <p className="text-xs text-destructive">
          {`Biography is capped at ${BIO_MAX_LABEL} characters.`}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Turns the selection into a link, or removes one.
 *
 * The href comes from the selected text, so there is no dialog to build and nothing to
 * type: selecting a URL and pressing the button links it. `safeHttpUrl` is the shared
 * guard, so this editor and the builder's accept exactly the same hrefs: a `javascript:`
 * href stored in a biography and rendered on an admin screen is a script running in the
 * organizer's session.
 */
function toggleLink(editor: Editor | null): void {
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
