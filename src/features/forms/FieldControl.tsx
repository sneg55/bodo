'use client'

// One question, rendered from its `FormField` definition.
//
// It lives here rather than under the submit route because two surfaces render the same
// question now: the public CFP wizard and the portal's submission-body edit (BUILD_SPEC
// 5.2). `src/app/**` holds routes only, and a second copy for the portal is the failure
// `.claude/rules/ui-shadcn.md` describes: two renderers of one field type drift, and the
// speaker then meets a different control depending on which door they came in through.
//
// The answer shapes here are the ones `@/features/forms/shape-checks` declares, and
// they have to match exactly: a multiselect stores an array of option values, a
// checkbox stores a boolean, a number stores the typed string (a form post carries
// strings, so the shape check accepts a numeric one), and everything else stores a
// string. A control that stored a convenient shape instead would pass the wizard's
// own validation and fail the server's.
//
// A `wysiwyg` question stores HTML, so it edits in the shared `RichTextEditor` and not in
// a Textarea. As a Textarea it showed the speaker their own abstract as `<p>A taxonomy of
// mid-trajectory failures.</p>`, and the counter under it charged them for the tags. The
// counter is honest now because `answerLength` measures markup as text, which is also what
// the server checks the cap against.
//
// `file` and `speaker_headshot` render as a link field, which is a decision worth
// naming: BUILD_SPEC section 5.2's upload endpoint (POST /api/files/upload, streaming
// to R2) does not exist yet, and rendering a dead file picker would make a REQUIRED
// file question impossible to satisfy and the form impossible to submit. A link is
// answerable now and is what the portal collects after acceptance anyway.

import { RichTextEditor } from '@/components/primitives/RichTextEditor'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  COUNTED_TYPES,
  DEFAULT_MAX_LEN_BY_TYPE,
  INPUT_TYPES,
  isDeadChoice,
  LONG_TEXT_TYPES,
} from '@/features/forms/control-types'
import { answerLength } from '@/features/forms/logic'
import type { FormField } from '@/types/forms'
import { cn } from '@/utils/cn'

const SELECT_PLACEHOLDER = 'Select...'
const TEXT_PLACEHOLDER = 'Enter text here...'

export type FieldControlProps = {
  field: FormField
  value: unknown
  onChange: (value: unknown) => void
  /** Rendered under the label, so a problem sits with the control that caused it. */
  problems?: readonly string[]
  disabled?: boolean
}

export function FieldControl({ field, value, onChange, problems, disabled }: FieldControlProps) {
  const messages = problems ?? []
  if (isDeadChoice(field, value)) return null
  return (
    <div className="flex flex-col gap-1.5">
      {/* `RichTextEditor` renders the label itself, above its own toolbar, so a wysiwyg
          question skips this one rather than showing it twice. */}
      {field.type === 'wysiwyg' ? null : (
        <Label htmlFor={field.id}>
          {field.label}
          {field.required ? (
            <span aria-hidden className="text-destructive">
              *
            </span>
          ) : null}
        </Label>
      )}
      <Control field={field} value={value} onChange={onChange} disabled={disabled} />
      <FieldFooter field={field} value={value} />
      {field.help === undefined ? null : (
        <p className="text-xs text-muted-foreground">{field.help}</p>
      )}
      {messages.map((message) => (
        <p key={message} className="text-xs text-destructive">
          {message}
        </p>
      ))}
    </div>
  )
}

/** The `n / 5,000 characters` counter, on the field types the builder caps. */
function FieldFooter({ field, value }: { field: FormField; value: unknown }) {
  const cap = field.maxLen ?? DEFAULT_MAX_LEN_BY_TYPE.get(field.type)
  if (cap === undefined || !COUNTED_TYPES.includes(field.type)) return null
  // `answerLength` measures a rich text answer as its TEXT, so this counter charges the
  // speaker for what they typed rather than for TipTap's tags, and it charges the same
  // number the server's `checkAnswer` will. One function, no disagreement.
  const used = answerLength(value, field.type)
  return (
    // `tabular-nums`: `used` recounts on every keystroke, and proportional digits change
    // the width of the whole line as it climbs, so the counter jitters under the field.
    <p
      className={cn(
        'text-xs tabular-nums',
        used > cap ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {`${used.toLocaleString('en-US')} / ${cap.toLocaleString('en-US')} characters`}
    </p>
  )
}

type ControlProps = {
  field: FormField
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

function Control(props: ControlProps) {
  const { field } = props
  if (field.type === 'checkbox') return <CheckboxControl {...props} />
  if (field.type === 'multiselect') return <MultiSelectControl {...props} />
  if (field.type === 'radio') return <RadioControl {...props} />
  if (field.type === 'select') return <SelectControl {...props} />
  if (field.type === 'wysiwyg') return <RichTextControl {...props} />
  if (LONG_TEXT_TYPES.includes(field.type)) return <LongTextControl {...props} />
  return <SingleLineControl {...props} />
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const items: readonly unknown[] = value
  return items.filter((item): item is string => typeof item === 'string')
}

function SingleLineControl({ field, value, onChange, disabled }: ControlProps) {
  return (
    <Input
      id={field.id}
      type={INPUT_TYPES.get(field.type) ?? 'text'}
      value={asText(value)}
      disabled={disabled}
      placeholder={field.type === 'text' ? TEXT_PLACEHOLDER : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function LongTextControl({ field, value, onChange, disabled }: ControlProps) {
  return (
    <Textarea
      id={field.id}
      value={asText(value)}
      disabled={disabled}
      rows={6}
      placeholder={TEXT_PLACEHOLDER}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/**
 * Rich text, through the shared primitive rather than a second editor.
 *
 * `RichTextEditor` owns the `next/dynamic` boundary in front of TipTap, so ProseMirror is
 * still only fetched on a form that actually asks a wysiwyg question, and the toolbar a
 * speaker gets here is the one the organizer authored the welcome message with.
 *
 * `disabled` is not passed on: the primitive has no disabled state, and the only caller
 * that sets it (`SubmissionBodyForm`, during its save transition) loses nothing by letting
 * the editor stay live, because the draft it saves is the one already in state.
 */
function RichTextControl({ field, value, onChange }: ControlProps) {
  return (
    <RichTextEditor
      id={field.id}
      label={field.label}
      required={field.required}
      value={asText(value)}
      onChange={onChange}
      placeholder={TEXT_PLACEHOLDER}
    />
  )
}

function SelectControl({ field, value, onChange, disabled }: ControlProps) {
  const current = asText(value)
  const options = field.options ?? []
  return (
    <Select
      value={current.length === 0 ? null : current}
      disabled={disabled}
      // Base UI resolves a selected value to its label through `items`, and without it
      // `SelectValue` prints the raw stored value. On the public CFP form that meant the
      // closed trigger read `workshop` instead of `Workshop (90 min)`, and a Track read
      // `recpzkMBucAKy1dRP` at a speaker. The options are already here; only the mapping
      // to what the trigger reads was missing.
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      onValueChange={(next: string | null) => {
        onChange(next ?? '')
      }}
    >
      <SelectTrigger id={field.id} className="w-full">
        <SelectValue placeholder={SELECT_PLACEHOLDER} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RadioControl({ field, value, onChange, disabled }: ControlProps) {
  return (
    <RadioGroup
      value={asText(value)}
      disabled={disabled}
      // Typed `unknown` rather than the primitive's generic default, which is `any`
      // and would leak an unsafe value into the store.
      onValueChange={(next: unknown) => {
        if (typeof next === 'string') onChange(next)
      }}
    >
      {(field.options ?? []).map((option) => (
        <Label key={option.value} className="font-normal">
          <RadioGroupItem value={option.value} />
          {option.label}
        </Label>
      ))}
    </RadioGroup>
  )
}

function MultiSelectControl({ field, value, onChange, disabled }: ControlProps) {
  const selected = asList(value)
  return (
    <div className="flex flex-col gap-2">
      {(field.options ?? []).map((option) => (
        <Label key={option.value} className="font-normal">
          <Checkbox
            checked={selected.includes(option.value)}
            disabled={disabled}
            onCheckedChange={(checked) => {
              onChange(
                checked
                  ? [...selected, option.value]
                  : selected.filter((item) => item !== option.value),
              )
            }}
          />
          {option.label}
        </Label>
      ))}
    </div>
  )
}

function CheckboxControl({ field, value, onChange, disabled }: ControlProps) {
  return (
    <Checkbox
      id={field.id}
      checked={value === true}
      disabled={disabled}
      onCheckedChange={(checked) => {
        onChange(checked)
      }}
    />
  )
}
