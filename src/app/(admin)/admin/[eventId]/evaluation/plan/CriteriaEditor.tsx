'use client'

// The scorecard editor: one row per criterion, with its kind, its range or its options,
// and its weight.
//
// The weight column carries a derived PERCENTAGE next to the raw number, and that is the
// point of the whole panel rather than a nicety. A weight is a ratio: 3 next to 1 means
// 75% and 25%, and until the share was on screen there was no way to tell that from two
// numbers in two boxes. `weightShares` computes it with the same arithmetic
// `scoring.ts` uses, and a test pins the two together.
//
// A criterion's KEY is generated once, when it is added, and never regenerated from the
// label afterwards. That is what lets an organizer rename "Relevance" to "Topic fit"
// without orphaning every score already filed against it. See `criterionKey`.

import { ChevronDownIcon, ChevronUpIcon, PlusIcon, XIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CRITERION_KINDS,
  criterionKey,
  criterionKindLabel,
  isCriterionKind,
  moveCriterion,
  newCriterion,
  weightShares,
} from '@/features/review/plan-editor'
import type { Criterion, CriterionKind } from '@/types/domain'

import { NumberField, OptionRows } from './CriterionFields'

export function CriteriaEditor({
  criteria,
  onChange,
}: {
  criteria: readonly Criterion[]
  onChange: (next: readonly Criterion[]) => void
}) {
  const shares = weightShares(criteria)

  const replace = (index: number, patch: Partial<Criterion>) => {
    onChange(criteria.map((item, at) => (at === index ? { ...item, ...patch } : item)))
  }

  const add = (kind: CriterionKind) => {
    onChange([
      ...criteria,
      newCriterion(
        kind,
        criterionKey(
          '',
          criteria.map((item) => item.key),
        ),
      ),
    ])
  }

  return (
    <div className="flex flex-col gap-3">
      {criteria.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No criteria yet. A round with none is still reviewable: reviewers get the comment box and
          the recommendation, and no submission gets an aggregate score.
        </p>
      ) : null}

      {criteria.map((criterion, index) => (
        <div key={criterion.key} className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor={`label-${criterion.key}`}>Label</Label>
              <Input
                id={`label-${criterion.key}`}
                value={criterion.label}
                placeholder="Relevance"
                onChange={(event) => replace(index, { label: event.target.value })}
              />
            </div>

            <div className="w-40 space-y-1.5">
              <Label htmlFor={`kind-${criterion.key}`}>Type</Label>
              <Select
                // Base UI's `Select.Value` prints the raw value unless the root carries this
                // map, so the closed trigger read the kind's slug where the list read its
                // label.
                items={Object.fromEntries(
                  CRITERION_KINDS.map((kind) => [kind, criterionKindLabel(kind)]),
                )}
                value={criterion.kind}
                onValueChange={(next: string | null) => {
                  if (next === null || !isCriterionKind(next)) return
                  // Rebuilt from `newCriterion` rather than patched, so switching to a
                  // dropdown brings its options and switching to free text drops the
                  // range and the weight. The key and the label are carried across,
                  // because those are the two things the organizer already typed.
                  const fresh = newCriterion(next, criterion.key)
                  onChange(
                    criteria.map((item, at) =>
                      at === index ? { ...fresh, label: criterion.label } : item,
                    ),
                  )
                }}
              >
                <SelectTrigger id={`kind-${criterion.key}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRITERION_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {criterionKindLabel(kind)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {criterion.kind === 'numeric' ? (
              <>
                <NumberField
                  id={`min-${criterion.key}`}
                  label="Min"
                  value={criterion.min}
                  onChange={(min) => replace(index, { min })}
                />
                <NumberField
                  id={`max-${criterion.key}`}
                  label="Max"
                  value={criterion.max}
                  onChange={(max) => replace(index, { max })}
                />
              </>
            ) : null}

            {criterion.kind === 'text' ? null : (
              <div className="w-28 space-y-1.5">
                <Label htmlFor={`weight-${criterion.key}`}>Weight</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={`weight-${criterion.key}`}
                    type="number"
                    min={0}
                    value={String(criterion.weight)}
                    onChange={(event) =>
                      replace(index, { weight: Number(event.target.value) || 0 })
                    }
                  />
                  <Badge variant="secondary" className="tabular-nums">
                    {Math.round((shares.get(criterion.key) ?? 0) * 100)}%
                  </Badge>
                </div>
              </div>
            )}

            <div className="flex items-center gap-0.5 pb-0.5">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move ${criterion.label || 'criterion'} up`}
                disabled={index === 0}
                onClick={() => onChange(moveCriterion(criteria, index, -1))}
              >
                <ChevronUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move ${criterion.label || 'criterion'} down`}
                disabled={index === criteria.length - 1}
                onClick={() => onChange(moveCriterion(criteria, index, 1))}
              >
                <ChevronDownIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${criterion.label || 'criterion'}`}
                onClick={() => onChange(criteria.filter((_, at) => at !== index))}
              >
                <XIcon />
              </Button>
            </div>
          </div>

          {criterion.kind === 'select' ? (
            <OptionRows criterion={criterion} onChange={(options) => replace(index, { options })} />
          ) : null}

          {criterion.kind === 'text' ? (
            <p className="text-xs text-muted-foreground">
              Free text is not scored, so it carries no weight and never reaches the aggregate.
            </p>
          ) : null}
        </div>
      ))}

      <div className="flex flex-wrap gap-1.5">
        {CRITERION_KINDS.map((kind) => (
          <Button key={kind} variant="outline" size="sm" onClick={() => add(kind)}>
            <PlusIcon />
            Add {criterionKindLabel(kind).toLowerCase()}
          </Button>
        ))}
      </div>
    </div>
  )
}
