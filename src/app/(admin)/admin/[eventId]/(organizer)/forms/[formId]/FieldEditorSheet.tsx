'use client'

// The right-hand drawer behind a row's Edit item: label, help text, character cap, the
// option list, and the conditional rule.
//
// A `Sheet`, per the component map, which puts every right-hand drawer in this product on
// the same primitive. What it contains is one of the parity doc's open questions, so it is
// scoped to what the stored `FormField` actually has: there is no control here for anything
// the definition cannot hold.
//
// The type is shown and not editable. Changing a question's type after answers exist would
// reinterpret every stored answer through a different shape check, and `registryKey` binds
// a library field's type to the column it writes to.

import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { OPTION_TYPES } from '@/features/forms/builder/draft'
import { type EventCategories, optionSource } from '@/features/forms/builder/option-sources'
import { FIELD_TYPE_LABELS, type FormField } from '@/types/forms'

import { ConditionEditor } from './ConditionEditor'
import { ConstrainedOptionsEditor } from './ConstrainedOptionsEditor'
import { OptionsEditor } from './OptionsEditor'

export type FieldEditorSheetProps = {
  /** Undefined closes the drawer, which is what "no row is being edited" means. */
  field: FormField | undefined
  fields: readonly FormField[]
  /**
   * The event whose categories a Track or Tags question may offer, and its id for the link
   * to the Library when there are none yet.
   *
   * Absent for a PORTAL form, and that is not an omission: a portal form's answers land in
   * `TaskAssignments.answersJson`, so its Track option values are inert text rather than
   * record ids in a link column (see the note on `writesLinkColumns` in checks.ts). The
   * free-text editor is the correct control there, and it is what this falls back to.
   */
  event?: { id: string; categories: EventCategories }
  onChange: (patch: Partial<FormField>) => void
  onClose: () => void
}

export function FieldEditorSheet({
  field,
  fields,
  event,
  onChange,
  onClose,
}: FieldEditorSheetProps) {
  // Which options control this question gets. A question bound to a link column or to a
  // constrained single select cannot have its values typed: see ConstrainedOptionsEditor.
  const source =
    field === undefined || event === undefined ? undefined : optionSource(field, event.categories)
  return (
    <Sheet
      open={field !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg!">
        <SheetHeader>
          <SheetTitle>Edit question</SheetTitle>
        </SheetHeader>

        {field === undefined ? null : (
          <div className="flex flex-col gap-4 px-4 pb-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="field-label">
                Label<span className="text-destructive"> *</span>
              </Label>
              <Input
                id="field-label"
                value={field.label}
                placeholder="Enter a question label..."
                onChange={(event) => onChange({ label: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {`Type: ${FIELD_TYPE_LABELS[field.type]}${
                  field.registryKey === undefined ? '' : ` · Library field (${field.registryKey})`
                }`}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="field-help">Help text</Label>
              <Textarea
                id="field-help"
                value={field.help ?? ''}
                placeholder="Shown under the control on the public form."
                onChange={(event) => onChange({ help: event.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="field-maxlen">Character limit</Label>
              <Input
                id="field-maxlen"
                type="number"
                min={1}
                value={field.maxLen === undefined ? '' : String(field.maxLen)}
                placeholder="No limit"
                onChange={(event) => onChange({ maxLen: parseCap(event.target.value) })}
              />
            </div>

            {OPTION_TYPES.includes(field.type) ? (
              <Card className="gap-2 px-4 py-3">
                {source === undefined ? (
                  <OptionsEditor
                    options={field.options ?? []}
                    onChange={(options) => onChange({ options })}
                  />
                ) : (
                  <ConstrainedOptionsEditor
                    source={source}
                    options={field.options ?? []}
                    onChange={(options) => onChange({ options })}
                    libraryHref={`/admin/${event?.id ?? ''}/settings/tags?tab=${source.settingsTab ?? 'tags'}`}
                  />
                )}
              </Card>
            ) : null}

            <Card className="gap-2 px-4 py-3">
              <ConditionEditor
                field={field}
                fields={fields}
                onChange={(showIf) => onChange({ showIf })}
              />
            </Card>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Blank clears the cap. A zero would be a limit nothing can satisfy, so it clears too. */
function parseCap(text: string): number | undefined {
  const parsed = Number(text.trim())
  if (!Number.isFinite(parsed) || parsed < 1) return undefined
  return Math.floor(parsed)
}
