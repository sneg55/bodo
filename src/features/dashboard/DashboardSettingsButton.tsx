'use client'

// Ref 38's `Settings` button on a custom dashboard, and the dialog it opens.
//
// **What Settings opens is an open question in the reference** (docs/parity/dashboard.md,
// Ambiguities: "rename, delete, sharing, widget layout?"), so this ships the subset that is
// backed by columns that exist: the tab's name, its dot colour, its description line, and
// deleting the dashboard. Nothing here invents a field. Widget layout is not offered because
// widget order has no editor yet, and sharing is not offered because there is nothing to share
// to: a dashboard is one event's own workspace in this build.
//
// A dead `Settings` button was the alternative and it is the worse one. Every control below
// changes something an organizer can then see in the tab strip.
//
// `AlertDialog` for the delete, per the UI rules: it is destructive, it takes the widgets with
// it, and the tab the organizer is standing on stops resolving, so the navigation afterwards is
// not optional.

import { SettingsIcon } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { deleteDashboardAction, updateDashboardAction } from '@/features/dashboard/actions'
import { DASHBOARD_COLOR_ITEMS, DashboardDot } from '@/features/dashboard/DashboardDot'
import type { Dashboard } from '@/services/airtable/mapping-dashboards'

export function DashboardSettingsButton({
  eventId,
  dashboard,
}: {
  eventId: string
  dashboard: Pick<Dashboard, 'id' | 'name' | 'color' | 'description'>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(dashboard.name)
  const [color, setColor] = useState<Dashboard['color']>(dashboard.color)
  const [description, setDescription] = useState(dashboard.description ?? '')
  const [pending, startTransition] = useTransition()

  const save = () => {
    startTransition(async () => {
      const result = await updateDashboardAction(eventId, dashboard.id, {
        name,
        color,
        description,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setOpen(false)
      toast.success('Saved successfully', { description: result.message })
      // A rename MOVES this page's URL, because the slug comes from the name. `replace` rather
      // than `push` so Back does not return to a segment that no longer resolves; `refresh` when
      // the URL did not change, since the name and the dot are in the tab strip, which is a
      // server component above this one.
      if (result.href !== undefined && result.href !== pathname) router.replace(result.href)
      else router.refresh()
    })
  }

  const remove = () => {
    startTransition(async () => {
      const result = await deleteDashboardAction(eventId, dashboard.id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setOpen(false)
      toast.success(result.message)
      // Away from a tab that no longer exists, back to Today.
      if (result.href !== undefined) router.push(result.href)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="hit-area-y" />}>
        {/* `data-icon="inline-start"` trips the Button's own optical padding
            (`has-data-[icon=inline-start]:pl-1.5` against a base `px-2.5`), so the leading
            icon sits closer to the edge than the trailing text and the label reads centred. */}
        <SettingsIcon data-icon="inline-start" />
        Settings
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dashboard settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashboard-name">Name</Label>
            <Input
              id="dashboard-name"
              value={name}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashboard-color">Color</Label>
            <Select
              value={color}
              items={DASHBOARD_COLOR_ITEMS}
              onValueChange={(next: string | null) => {
                const match = DASHBOARD_COLOR_ITEMS.find((item) => item.value === next)
                if (match !== undefined) setColor(match.value)
              }}
            >
              <SelectTrigger id="dashboard-color" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DASHBOARD_COLOR_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    <DashboardDot color={item.value} />
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashboard-description">Description</Label>
            <Textarea
              id="dashboard-description"
              value={description}
              maxLength={500}
              rows={3}
              onChange={(event) => {
                setDescription(event.target.value)
              }}
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="ghost" className="text-destructive" disabled={pending} />}
            >
              Delete dashboard
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{`Delete "${dashboard.name}"?`}</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the tab and every widget on it. It cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex gap-2">
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={save} disabled={pending || name.trim() === ''}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
