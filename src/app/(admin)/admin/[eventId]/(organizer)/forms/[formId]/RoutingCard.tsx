'use client'

// Category routing (`Forms.routingJson`): "when this answer, file it under this category",
// plus the fallback.
//
// This card has no screenshot. The parity doc never captured routing, and BUILD_SPEC 5.1
// requires it and makes it half of the R1 acceptance criterion ("a form with a conditional
// field and 2 routing tracks can be built in the UI ... and appears in Abstracts under the
// right track"), so it is placed with the abstract questions, because that is what the rules
// fire on. If a screenshot later shows it elsewhere, this card moves.
//
// Track IS the category (BUILD_SPEC 3), which is why the labels below say category and the
// values are Track record ids: routing sets `Submissions.track`, the Abstracts filters read
// it, and reviewers are assigned by it.

import { PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { NamedOption } from '@/features/forms/builder/defaults'
import { routableFields } from '@/features/forms/builder/field-ops'
import type { FormField, RoutingConfig, RoutingRule } from '@/types/forms'

export type RoutingCardProps = {
  fields: readonly FormField[]
  routing: RoutingConfig
  trackOptions: readonly NamedOption[]
  onChange: (routing: RoutingConfig) => void
}

export function RoutingCard({ fields, routing, trackOptions, onChange }: RoutingCardProps) {
  const routable = routableFields(fields)

  function setRules(rules: readonly RoutingRule[]): void {
    onChange({ rules, defaultTrackId: routing.defaultTrackId })
  }

  function patch(index: number, next: Partial<RoutingRule>): void {
    setRules(routing.rules.map((rule, at) => (at === index ? { ...rule, ...next } : rule)))
  }

  function add(): void {
    const question = routable.at(0)
    const track = trackOptions.at(0)
    if (question === undefined || track === undefined) return
    setRules([
      ...routing.rules,
      {
        when: { fieldId: question.id, op: 'eq', value: question.options?.at(0)?.value },
        trackId: track.value,
      },
    ])
  }

  return (
    <Card className="gap-3 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Category routing</h3>
        <Button
          variant="outline"
          size="sm"
          disabled={routable.length === 0 || trackOptions.length === 0}
          onClick={add}
        >
          <PlusIcon />
          Add rule
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        File each submission under a category from one of its answers. The first matching rule wins,
        and the fallback applies when none do.
      </p>

      {routable.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Routing needs a question with a fixed option list, such as Format or Track.
        </p>
      ) : null}

      {routing.rules.map((rule, index) => (
        <RuleRow
          key={`${rule.when.fieldId}-${String(index)}`}
          rule={rule}
          index={index}
          routable={routable}
          trackOptions={trackOptions}
          onPatch={patch}
          onRemove={() => setRules(routing.rules.filter((_, at) => at !== index))}
        />
      ))}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="routing-default">Fallback category</Label>
        <Select
          value={routing.defaultTrackId ?? null}
          items={trackOptions}
          onValueChange={(next: string | null) =>
            onChange({ rules: routing.rules, defaultTrackId: next ?? undefined })
          }
        >
          <SelectTrigger id="routing-default" className="w-full sm:w-72">
            <SelectValue placeholder="No fallback" />
          </SelectTrigger>
          <SelectContent>
            {trackOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Card>
  )
}

type RuleRowProps = {
  rule: RoutingRule
  index: number
  routable: readonly FormField[]
  trackOptions: readonly NamedOption[]
  onPatch: (index: number, next: Partial<RoutingRule>) => void
  onRemove: () => void
}

/**
 * One rule. Every Select carries `items`, because base-ui's Select.Value renders the raw
 * value when it cannot look a label up, and a rule reading "recABC is talk, file under
 * recXYZ" is not something an organizer can check.
 */
function RuleRow({ rule, index, routable, trackOptions, onPatch, onRemove }: RuleRowProps) {
  const question = routable.find((field) => field.id === rule.when.fieldId)
  const options = question?.options ?? []

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border p-2">
      <span className="text-xs text-muted-foreground">When</span>
      <Select
        value={rule.when.fieldId}
        items={routable.map((field) => ({ value: field.id, label: field.label }))}
        onValueChange={(next: string | null) => {
          if (next !== null) onPatch(index, { when: { fieldId: next, op: 'eq', value: undefined } })
        }}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Question" />
        </SelectTrigger>
        <SelectContent>
          {routable.map((field) => (
            <SelectItem key={field.id} value={field.id}>
              {field.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-xs text-muted-foreground">is</span>
      <Select
        value={typeof rule.when.value === 'string' ? rule.when.value : null}
        items={options.map((option) => ({ value: option.value, label: option.label }))}
        onValueChange={(next: string | null) => {
          if (next !== null) onPatch(index, { when: { ...rule.when, value: next } })
        }}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Answer" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-xs text-muted-foreground">file under</span>
      <Select
        value={rule.trackId}
        items={trackOptions}
        onValueChange={(next: string | null) => {
          if (next !== null) onPatch(index, { trackId: next })
        }}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          {trackOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onRemove}>
        <XIcon />
        <span className="sr-only">{`Remove rule ${String(index + 1)}`}</span>
      </Button>
    </div>
  )
}
