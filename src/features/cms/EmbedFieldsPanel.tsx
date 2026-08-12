'use client'

// Ref 33's left pane: the `Field Options` section.
//
// TRANSCRIBED, from docs/parity/external-references.md, verbatim: "Choose fields for the Agenda,
// Speaker, and Session cards. Grey fields are required; blue fields are preselected and
// customizable." So: three groups, a grey non-deselectable tier, and a preselected tier in the
// accent colour. All three properties are rendered below.
//
// The accent is the `primary` token rather than a literal blue, for the reason the ui-shadcn rule
// gives: bodo's palette differs from Sessionboard's while the layout matches, and `text-blue-600`
// would also break in dark mode. Grey is `text-muted-foreground`, which is the same token every
// disabled control in the app uses.
//
// AUTHORED: the field names, and @/features/cms/field-options records the derivation per field plus
// what was excluded and why. The short version is that each one is a field an embed view already
// renders, that the reference's own Session and SessionSpeaker objects carry, and that our schema
// stores. A speaker's email, phone and postal address are excluded outright, whatever the reference
// lists, because a served embed renders on a page this app does not control.

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { EmbedSection } from '@/features/cms/EmbedSection'
import {
  EMBED_CARD_TYPES,
  type EmbedFieldSpec,
  embedCardFields,
  embedCardLabel,
} from '@/features/cms/field-options'
import type { EmbedCardType, EmbedFieldOptions } from '@/types/cms'
import { cn } from '@/utils/cn'

export type EmbedFieldsProps = {
  fieldOptions: EmbedFieldOptions
  /** Which card the previewed view draws, so the relevant group can say so. */
  activeCard: EmbedCardType
  onToggle: (card: EmbedCardType, key: string, on: boolean) => void
  isSelected: (card: EmbedCardType, key: string) => boolean
}

export function EmbedFieldsPanel(props: EmbedFieldsProps) {
  return (
    <EmbedSection title="Field Options">
      <p className="text-pretty text-xs text-muted-foreground">
        Grey fields are required. The rest are preselected and can be switched off.
      </p>
      {EMBED_CARD_TYPES.map((card) => (
        <fieldset key={card} className="flex flex-col gap-2">
          <legend className="pb-1 text-sm font-medium">
            {embedCardLabel(card)}
            {card === props.activeCard ? (
              // Which card the preview is currently showing. Authored, and it earns its place: three
              // groups with no indication of which one the pane on the right is drawing makes two of
              // them look broken when a checkbox changes nothing visible.
              <span className="pl-2 text-xs font-normal text-muted-foreground">in preview</span>
            ) : null}
          </legend>
          {embedCardFields(card).map((spec) => (
            <FieldChoice
              key={spec.key}
              card={card}
              spec={spec}
              checked={spec.required || props.isSelected(card, spec.key)}
              onToggle={props.onToggle}
            />
          ))}
        </fieldset>
      ))}
    </EmbedSection>
  )
}

function FieldChoice({
  card,
  spec,
  checked,
  onToggle,
}: {
  card: EmbedCardType
  spec: EmbedFieldSpec
  checked: boolean
  onToggle: (card: EmbedCardType, key: string, on: boolean) => void
}) {
  const id = `embed-field-${card}-${spec.key}`

  return (
    <div className="flex items-center gap-2">
      {/* Disabled AND always checked. The disabled attribute is the affordance; the guarantee is in
          `visibleEmbedFields`, which unions the required tier back in whatever the stored blob says,
          because that blob is an Airtable cell somebody can edit by hand. */}
      <Checkbox
        id={id}
        checked={checked}
        disabled={spec.required}
        onCheckedChange={(next: boolean) => {
          onToggle(card, spec.key, next)
        }}
      />
      <Label
        htmlFor={id}
        className={cn(
          'text-sm font-normal',
          spec.required ? 'text-muted-foreground' : checked ? 'text-primary' : '',
        )}
      >
        {spec.label}
      </Label>
    </div>
  )
}
