'use client'

// The dynamic-import boundary in front of TipTap, plus the label and toggle a rich text
// field carries in the builder.
//
// `ssr: false` because the editor owns a contentEditable node: server-rendering it
// produces markup the client immediately replaces, which is a hydration mismatch on the
// first keystroke and a wasted payload either way.

import dynamic from 'next/dynamic'

import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

const RichTextEditorBody = dynamic(() => import('@/components/primitives/RichTextEditorBody'), {
  ssr: false,
  loading: () => <Skeleton className="h-40 w-full rounded-lg" />,
})

export type RichTextEditorProps = {
  id: string
  label: string
  value: string
  onChange: (html: string) => void
  placeholder?: string
  required?: boolean
  help?: string
  /** Renders a right-aligned toggle beside the label, as the Welcome Message card has. */
  toggle?: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }
}

export function RichTextEditor({
  id,
  label,
  value,
  onChange,
  placeholder,
  required = false,
  help,
  toggle,
}: RichTextEditorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {required ? <span className="text-destructive"> *</span> : null}
        </Label>
        {toggle === undefined ? null : (
          <span className="flex items-center gap-2">
            <Label htmlFor={`${id}-toggle`} className="text-xs text-muted-foreground">
              {toggle.label}
            </Label>
            <Switch
              id={`${id}-toggle`}
              checked={toggle.checked}
              onCheckedChange={toggle.onCheckedChange}
            />
          </span>
        )}
      </div>

      {toggle !== undefined && !toggle.checked ? null : (
        <div id={id}>
          {/* `initialHtml` and not `value`: the editor is controlled by callback, because
              feeding the value back in on every keystroke resets the caret. */}
          <RichTextEditorBody initialHtml={value} onChange={onChange} placeholder={placeholder} />
        </div>
      )}

      {help === undefined ? null : (
        // `text-pretty` because this is a one- or two-line caption under a wide field, which
        // is where a last line of one word is most visible.
        <p className="text-xs text-pretty text-muted-foreground">{help}</p>
      )}
    </div>
  )
}
