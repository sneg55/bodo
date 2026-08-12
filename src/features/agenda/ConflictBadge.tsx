import { AlertTriangleIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

export function ConflictBadge({ count, compact = false }: { count: number; compact?: boolean }) {
  if (count === 0) return null

  return (
    <Badge variant="destructive" className="shrink-0 tabular-nums">
      <AlertTriangleIcon />
      {compact ? count : `${count} conflict${count === 1 ? '' : 's'}`}
    </Badge>
  )
}
