'use client'

// Step: mapping. Sessionize only. BUILD_SPEC 5.0e, trap 4.
//
// Sessionize categories are USER-NAMED and untyped beyond `session` / `speaker`. The
// documented demo event's happen to be `Session format`, `Track`, `Level` and `Language`,
// and nothing in the payload guarantees a single one of those names, so nothing may read a
// title as a type. One `Select` per category, choosing which bodo concept it feeds.
//
// THE SUGGESTION IS NEVER APPLIED UNCONFIRMED, and that asymmetry is the whole point of the
// screen. Every Select starts EMPTY with its guess printed beside it, because a wrong guess
// applied silently turns an event's Track taxonomy into tags, or drops a category entirely,
// and the organizer finds out after the run has written everything. `targetFor()` returns
// undefined for an unconfirmed category by design, and `isMappingComplete` is what stops
// the wizard advancing, so an unanswered row cannot reach the run at all.
//
// `Use all suggestions` is the concession to that being tedious, and it is a CONFIRMATION
// rather than a default: it fills the Selects in one press and the organizer can still see
// and change every one of them before Continue. That is what `suggestedMapping` was built
// for, and it is the difference between a glance and a click and a pre-ticked box.
//
// Sessionboard and Accelevents never render this. Both type their taxonomies on their own
// side, so `importWizardSteps` does not give them the step rather than showing them a page
// that says there is nothing to do.

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { suggestedMapping } from '@/features/imports/categories'
import {
  IMPORT_CATEGORY_TARGET_LABELS,
  IMPORT_CATEGORY_TARGETS,
  type ImportCategoryPreview,
  type ImportCategoryTarget,
  type ImportMapping,
} from '@/types/imports'

const TARGET_LABEL = new Map<string, string>(Object.entries(IMPORT_CATEGORY_TARGET_LABELS))

const TARGET_ITEMS = IMPORT_CATEGORY_TARGETS.map((target) => ({
  value: target,
  label: TARGET_LABEL.get(target) ?? target,
}))

export type MappingStepProps = {
  categories: readonly ImportCategoryPreview[]
  /** False while the dry run that discovers the categories is still in flight. */
  known: boolean
  mapping: ImportMapping
  onChange: (next: ImportMapping) => void
  disabled: boolean
}

export function MappingStep({ categories, known, mapping, onChange, disabled }: MappingStepProps) {
  if (!known) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    )
  }

  if (categories.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This Sessionize event declares no categories, so there is nothing to map. Sessions arrive
        with their room and their schedule and no track or tag.
      </p>
    )
  }

  // A Map, because indexing a record with a runtime category id is an object-injection sink.
  const chosen = new Map(Object.entries(mapping.categories))

  const setTarget = (categoryId: string, target: ImportCategoryTarget) => {
    onChange({ categories: { ...mapping.categories, [categoryId]: target } })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Sessionize lets an organizer name these, so bodo cannot read a title as a type. Choose
          what each one feeds. Anything left unanswered blocks the import rather than being guessed.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onChange(suggestedMapping(categories))
          }}
        >
          Use all suggestions
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {categories.map((category) => {
          const value = chosen.get(category.id)
          return (
            <li
              key={category.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <Label htmlFor={`category-${category.id}`} className="text-sm font-medium">
                  {category.title === '' ? `Category ${category.id}` : category.title}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {`${String(category.itemCount)} item${category.itemCount === 1 ? '' : 's'}`}
                </p>
              </div>

              {/* The guess, shown and not applied. It is here so the common case is a
                  glance, and beside the control rather than inside it so nobody can mistake
                  it for an answer already given. */}
              <Badge variant="outline">
                {`Suggested: ${TARGET_LABEL.get(category.suggested) ?? category.suggested}`}
              </Badge>

              <Select
                value={value ?? null}
                items={TARGET_ITEMS}
                disabled={disabled}
                onValueChange={(next: string | null) => {
                  if (next !== null) setTarget(category.id, next as ImportCategoryTarget)
                }}
              >
                <SelectTrigger id={`category-${category.id}`} className="w-44">
                  <SelectValue placeholder="Choose one" />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
