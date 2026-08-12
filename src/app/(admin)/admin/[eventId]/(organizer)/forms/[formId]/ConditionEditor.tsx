'use client'

// Authoring a `showIf` rule: "Show this question only when <question> <is|is not|is
// answered> <value>".
//
// The rule language is exactly what `@/features/forms/logic` already evaluates and is not
// extended here: four operators, one controlling question, one value. Nothing in the parity
// doc asks for more, and a second dialect would mean the wizard silently ignoring half of
// what the builder can express.
//
// The controlling question comes from `ruleControllers`, which offers only the questions asked
// BEFORE this one that are not themselves conditional, and of those only the three field types
// the reference says question rules are available for. The position half is the
// one-dependency-level contract in BUILD_SPEC 5.1: a question cannot depend on an answer the
// speaker has not been asked for, and a chain is a second level. The TYPE half is the
// reference's, quoted in the two lines of copy below, and it is stated on the control rather
// than applied silently: an organizer who cannot find their Radio question in the picker needs
// to be told why, not left to conclude the picker is broken.
//
// The value is a picker rather than a text box when the controlling question has options,
// because a typo there produces a rule that silently never fires. A Checkbox and a Number have
// no options, so they get the two controls `ruleValueMode` names instead.

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ruleControllers, ruleValueMode } from '@/features/forms/builder/field-ops'
import type { FieldCondition, FormField } from '@/types/forms'

const OPS: readonly { value: FieldCondition['op']; label: string }[] = [
  { value: 'eq', label: 'is' },
  { value: 'neq', label: 'is not' },
  { value: 'in', label: 'is any of' },
  { value: 'answered', label: 'is answered' },
]

const OP_LABELS: ReadonlyMap<string, string> = new Map(OPS.map((op) => [op.value, op.label]))

/** The reference's own sentences, off `/sessions/submission-forms`. Do not improve them. */
const AVAILABILITY_NOTE = 'Available for Checkbox, Dropdown, and Number fields.'
const ORDER_NOTE = 'Create and save all fields before applying rules.'

/** A Checkbox has no option list, so its two answers are named rather than typed. */
const BOOLEAN_ITEMS: readonly { value: string; label: string }[] = [
  { value: 'true', label: 'Checked' },
  { value: 'false', label: 'Unchecked' },
]

export type ConditionEditorProps = {
  field: FormField
  fields: readonly FormField[]
  onChange: (condition: FieldCondition | undefined) => void
}

export function ConditionEditor({ field, fields, onChange }: ConditionEditorProps) {
  const condition = field.showIf
  const controllers = ruleControllers(fields, field.id, condition?.fieldId)
  const controller = controllers.find((candidate) => candidate.id === condition?.fieldId)
  const options = controller?.options ?? []
  const valueMode = ruleValueMode(controller)
  // `items` on each Select is what makes the trigger show a label rather than the stored
  // value: base-ui's Select.Value renders the raw value unless it can look a label up, and
  // a rule reading "recXYZ is talk" is not something an organizer can check.
  const controllerItems: readonly { value: string; label: string }[] = controllers.map(
    (candidate) => ({ value: candidate.id, label: labelOf(candidate) }),
  )

  function enable(on: boolean): void {
    const first = controllers.at(0)
    if (!on || first === undefined) {
      onChange(undefined)
      return
    }
    onChange({ fieldId: first.id, op: 'answered' })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="condition-enabled">Conditional logic</Label>
        <Switch
          id="condition-enabled"
          checked={condition !== undefined}
          disabled={controllers.length === 0}
          onCheckedChange={enable}
        />
      </div>

      <p className="text-xs text-muted-foreground">{`${AVAILABILITY_NOTE} ${ORDER_NOTE}`}</p>

      {controllers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          A condition needs an earlier Checkbox, Dropdown or Number question to depend on. Move this
          question down, or add one above it.
        </p>
      ) : null}

      {condition === undefined ? (
        <p className="text-xs text-muted-foreground">
          Always shown. Turn this on to show the question only for certain answers.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <Select
            value={condition.fieldId}
            items={controllerItems}
            onValueChange={(next: string | null) => {
              // The value is cleared with the question: an option value from the previous
              // controller would be a rule that never fires.
              if (next !== null) onChange({ fieldId: next, op: condition.op, value: undefined })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select question..." />
            </SelectTrigger>
            <SelectContent>
              {controllers.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {labelOf(candidate)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={condition.op}
            items={OPS}
            onValueChange={(next: string | null) => {
              if (next === null) return
              const op = OPS.find((entry) => entry.value === next)?.value
              if (op !== undefined) onChange({ ...condition, op })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPS.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {OP_LABELS.get(op.value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {condition.op === 'answered' ? null : (
            <ValueControl
              mode={valueMode}
              condition={condition}
              options={options}
              onChange={onChange}
            />
          )}

          {condition.op !== 'answered' && valueMode === 'none' ? (
            <p className="text-xs text-destructive">
              That question has no answers to match against yet. Add its options, or use is
              answered.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}

/**
 * The rule's value: an option picker, the two named checkbox states, or a text box.
 *
 * Its own component because the three-way branch inside the editor pushed that function over
 * the cognitive-complexity limit, which is a fair complaint: the mode is decided by
 * `ruleValueMode` and this only draws it.
 */
function ValueControl({
  mode,
  condition,
  options,
  onChange,
}: {
  mode: ReturnType<typeof ruleValueMode>
  condition: FieldCondition
  options: readonly { value: string; label: string }[]
  onChange: (condition: FieldCondition) => void
}) {
  if (mode === 'none') return null
  if (mode === 'text') {
    return (
      <Input
        aria-label="Answer to match"
        // `text` is only reached for a Number controller, and a Number answer is stored as a
        // numeric string (`shape-checks`), so a non-numeric value here authors a rule that can
        // never match: the builder would accept it and the form would silently never show the
        // dependent question. Constraining the control is the fix rather than validating on
        // save, because the organizer finds out while typing. Found by Codex review.
        type="number"
        value={typeof condition.value === 'string' ? condition.value : ''}
        placeholder="Enter the answer to match..."
        onChange={(event) => onChange({ ...condition, value: event.target.value })}
      />
    )
  }

  const items = mode === 'boolean' ? BOOLEAN_ITEMS : options
  return (
    <Select
      value={typeof condition.value === 'string' ? condition.value : null}
      items={items}
      onValueChange={(next: string | null) => {
        if (next !== null) onChange({ ...condition, value: next })
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select answer..." />
      </SelectTrigger>
      <SelectContent>
        {items.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A question with no label yet still needs something readable in a rule. */
function labelOf(field: FormField): string {
  return field.label.trim().length === 0 ? 'Untitled question' : field.label.trim()
}
