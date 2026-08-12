'use client'

// The per-portal settings, transcribed rather than invented: `welcomeMessage` through the
// shared RichTextEditor primitive, `Always Show Tasks`, and `Manage Profile`. Those last two
// labels are the vendor's own and are not reworded here.
//
// The name and the filters sit on this card too, and that is a decision worth stating: they
// are written by the same `savePortalAction`, and a portal whose filter matches nobody is
// the failure mode of this whole feature. Sending an organizer back through the create
// wizard to fix a rule they can see the count for on the list screen would be the only way
// to change one otherwise.
//
// The DEFAULT portal renders no filter editor. It carries none by definition and
// `firstMatch` ignores any that were written by hand, so an editor there would offer a rule
// that provably does nothing; `savePortalAction` forces its filters back to empty for the
// same reason. What it gets instead is the sentence saying what it actually is.
//
// Controlled throughout. The parent owns the draft because it also owns the four content
// cards and one Save covers the page, exactly as Event Details does.

import { RichTextEditor } from '@/components/primitives/RichTextEditor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { PortalContactType, PortalFilterRule } from '@/types/portals'

import { type FilterOption, PortalFilterEditor } from './PortalFilterEditor'

export type PortalSettingsDraft = {
  name: string
  contactTypes: readonly PortalContactType[]
  rules: readonly PortalFilterRule[]
  welcomeMessage: string
  alwaysShowTasks: boolean
  manageProfile: boolean
}

export type PortalSettingsCardProps = {
  draft: PortalSettingsDraft
  onChange: (patch: Partial<PortalSettingsDraft>) => void
  isDefault: boolean
  tracks: readonly FilterOption[]
  tags: readonly FilterOption[]
  disabled?: boolean
}

export function PortalSettingsCard({
  draft,
  onChange,
  isDefault,
  tracks,
  tags,
  disabled = false,
}: PortalSettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portal settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="portal-name">Name</Label>
          <Input
            id="portal-name"
            value={draft.name}
            disabled={disabled}
            className="max-w-md"
            onChange={(event) => {
              onChange({ name: event.target.value })
            }}
          />
        </div>

        {isDefault ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            This is the default portal. It takes every contact who matches no portal above it, so it
            has no filters of its own and cannot be moved or deleted.
          </p>
        ) : (
          <PortalFilterEditor
            contactTypes={draft.contactTypes}
            onContactTypesChange={(contactTypes) => {
              onChange({ contactTypes })
            }}
            rules={draft.rules}
            onRulesChange={(rules) => {
              onChange({ rules })
            }}
            tracks={tracks}
            tags={tags}
            disabled={disabled}
          />
        )}

        <RichTextEditor
          id="portal-welcome-message"
          label="Welcome message"
          value={draft.welcomeMessage}
          help="Shown at the top of the portal, above whatever the speaker is being asked for."
          onChange={(welcomeMessage) => {
            onChange({ welcomeMessage })
          }}
        />

        <div className="flex flex-col gap-3">
          <Label className="flex items-start gap-3 font-normal">
            <Switch
              checked={draft.alwaysShowTasks}
              disabled={disabled}
              onCheckedChange={(alwaysShowTasks: boolean) => {
                onChange({ alwaysShowTasks })
              }}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Always Show Tasks</span>
              <span className="text-xs text-muted-foreground">
                Keeps the Tasks section on screen for a speaker with none assigned, instead of
                hiding it. It assigns nobody anything.
              </span>
            </span>
          </Label>

          <Label className="flex items-start gap-3 font-normal">
            <Switch
              checked={draft.manageProfile}
              disabled={disabled}
              onCheckedChange={(manageProfile: boolean) => {
                onChange({ manageProfile })
              }}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Manage Profile</span>
              <span className="text-xs text-muted-foreground">
                Lets a speaker edit their own name, biography, headshot and links from this portal.
              </span>
            </span>
          </Label>
        </div>
      </CardContent>
    </Card>
  )
}
