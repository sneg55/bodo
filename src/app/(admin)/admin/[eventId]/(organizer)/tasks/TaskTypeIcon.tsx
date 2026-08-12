// The person / two-person / calendar icon that ref 25 and ref 31 put next to a type.
//
// A component that switches on the type rather than a `Record<TaskEntityType, LucideIcon>`
// looked up at render. Picking the component out of a lookup inside a render is what
// `react-hooks/static-components` refuses, and it is right to: a component value produced
// during render is a different component identity each time, so React remounts it and any
// state inside it resets.

import { CalendarIcon, UserIcon, UsersIcon } from 'lucide-react'

import type { TaskEntityType } from '@/constants/status'

export function TaskTypeIcon({
  entityType,
  className = 'size-4',
}: {
  entityType: TaskEntityType
  className?: string
}) {
  if (entityType === 'submission') return <CalendarIcon className={className} />
  if (entityType === 'group') return <UsersIcon className={className} />
  return <UserIcon className={className} />
}
