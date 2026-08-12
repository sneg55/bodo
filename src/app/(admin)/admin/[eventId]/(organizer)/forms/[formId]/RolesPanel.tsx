'use client'

// The participant roles panel on step 4 (parity ref 10): per-role enable checkbox, role
// name, Min and Max, collapsible, with the transcribed copy.
//
// The overall limit across all roles is derived rather than stored, per BUILD_SPEC 5.1: no
// screenshot shows a control for it, so it is the sum of the enabled roles' maxima and is
// shown as a computed line rather than invented as an input.

import { ChevronDownIcon } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PARTICIPANT_ROLE_LABELS, type ParticipantRole } from '@/constants/status'
import type { ParticipantRoleRule } from '@/types/forms'

const ROLE_LABELS: ReadonlyMap<ParticipantRole, string> = new Map(
  Object.entries(PARTICIPANT_ROLE_LABELS).map(([role, label]) => [role as ParticipantRole, label]),
)

export type RolesPanelProps = {
  roles: readonly ParticipantRoleRule[]
  onChange: (roles: readonly ParticipantRoleRule[]) => void
}

export function RolesPanel({ roles, onChange }: RolesPanelProps) {
  function patch(role: ParticipantRole, next: Partial<ParticipantRoleRule>): void {
    onChange(roles.map((rule) => (rule.role === role ? { ...rule, ...next } : rule)))
  }

  const overall = roles.filter((rule) => rule.enabled).reduce((sum, rule) => sum + rule.max, 0)

  return (
    <Card className="gap-2 px-4 py-3">
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
          <span className="text-sm font-semibold">Participant roles</span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 pt-2">
          <p className="text-xs text-muted-foreground">
            Choose which roles submitters can add. Optionally set minimum and maximum counts per
            role, and overall limits across all roles.
          </p>

          <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 text-xs text-muted-foreground">
            <span />
            <span>Min</span>
            <span>Max</span>
          </div>

          {roles.map((rule) => (
            <div key={rule.role} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2">
              <span className="flex items-center gap-2">
                <Checkbox
                  id={`role-${rule.role}`}
                  checked={rule.enabled}
                  onCheckedChange={(checked) => patch(rule.role, { enabled: checked === true })}
                />
                <Label htmlFor={`role-${rule.role}`}>{ROLE_LABELS.get(rule.role)}</Label>
              </span>
              <Input
                type="number"
                min={0}
                value={String(rule.min)}
                disabled={!rule.enabled}
                aria-label={`${ROLE_LABELS.get(rule.role) ?? rule.role} minimum`}
                onChange={(event) => patch(rule.role, { min: count(event.target.value) })}
              />
              <Input
                type="number"
                min={0}
                value={String(rule.max)}
                disabled={!rule.enabled}
                aria-label={`${ROLE_LABELS.get(rule.role) ?? rule.role} maximum`}
                onChange={(event) => patch(rule.role, { max: count(event.target.value) })}
              />
            </div>
          ))}

          <p className="text-xs text-muted-foreground">
            {`Up to ${String(overall)} participants in total, which is the sum of the enabled roles.`}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function count(text: string): number {
  const parsed = Number(text.trim())
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.min(99, Math.floor(parsed))
}
