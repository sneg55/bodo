'use client'

// The TipTap instance behind `RichTextEditor`. Never imported directly: `RichTextEditor`
// is the `next/dynamic` boundary, because ProseMirror is a large bundle and only the form
// builder and the portal profile need it (.claude/rules/bodo-conventions.md).
//
// Controlled by callback rather than by prop. The builder holds the whole form draft in
// one piece of state, so it needs the HTML as the organizer types; feeding `value` back
// into the editor on every keystroke would reset the ProseMirror selection instead.
//
// The whole reference toolbar ships: bold, italic, underline, superscript, subscript,
// link, bulleted list, numbered list, outdent, indent, align left/center/right, image and
// the `...` overflow menu, plus the block-tag status bar and the resizable editor area.
// The buttons live in RichTextEditorToolbar; this file owns the extension set they drive,
// and every extension named here is what makes a given button more than decoration.

import { EditorContent, useEditor } from '@tiptap/react'
import {
  RichTextEditorStatus,
  RichTextEditorToolbar,
} from '@/components/primitives/RichTextEditorToolbar'
import {
  RICH_TEXT_PLACEHOLDER,
  richTextExtensions,
} from '@/components/primitives/rich-text-extensions'

// No `sup`/`sub` rules on purpose: Tailwind's preflight already styles both, and the
// public form renders the same stored markup with the same preflight, so leaving them
// alone is what keeps the editor showing what the visitor will see.
//
// `text-pretty` is here for the same reason: `text-wrap` is an inherited property, so one
// class on the editable root reaches every paragraph and list item inside it and stops the
// last line of each landing on a single word. Both sinks that render this markup back to a
// reader (OrganizerHtml, SpeakerHtml) set it too, so what is typed wraps the way it will be
// read.
const CONTENT_CLASS =
  'min-h-28 px-3 py-2 text-sm text-pretty outline-none [&_p]:my-1 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_img]:my-1 [&_img]:rounded-md [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]'

export type RichTextEditorBodyProps = {
  initialHtml: string
  onChange: (html: string) => void
  placeholder?: string
}

export default function RichTextEditorBody({
  initialHtml,
  onChange,
  placeholder,
}: RichTextEditorBodyProps) {
  const editor = useEditor({
    // Declared in rich-text-extensions.ts, so the schema a test builds is the schema this
    // editor runs on. Every button in the toolbar needs one of the extensions in there.
    extensions: richTextExtensions(placeholder ?? RICH_TEXT_PLACEHOLDER),
    content: initialHtml,
    // Required with SSR: rendering immediately produces markup React did not produce.
    immediatelyRender: false,
    editorProps: { attributes: { class: CONTENT_CLASS } },
    onUpdate: ({ editor: updated }) => {
      onChange(updated.getHTML())
    },
  })

  return (
    // `resize-y` on the container is the resize handle the reference shows at the editor's
    // bottom right: the browser draws it, and it needs `overflow` other than visible, which
    // is why the content area below scrolls rather than the page.
    <div className="flex min-h-40 resize-y flex-col overflow-hidden rounded-lg border border-input">
      <RichTextEditorToolbar editor={editor} />
      <div className="flex-1 overflow-auto">
        <EditorContent editor={editor} />
      </div>
      <RichTextEditorStatus editor={editor} />
    </div>
  )
}
