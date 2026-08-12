'use client'

// Step 2, Welcome Screen (parity ref 07).
//
// All three transcribed fields are here. "External Form Title" and "Page Heading" were
// absent while `Forms` had no column for them, on the rule that a control which stores
// something nothing reads is worse than a missing one; they now have columns, and the public
// wizard renders both (the title heads the Welcome step, the heading is its rail label).

import { RichTextEditor } from '@/components/primitives/RichTextEditor'
import { Card } from '@/components/ui/card'

import { CountedInput } from './CountedInput'
import type { StepProps } from './EditorStepBody'
import { WelcomeHeadingFields } from './HeadingFields'

const NAME_MAX = 255

export function StepWelcome({ draft, patch }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        The first screen a user will see before submitting their abstract.
      </p>

      <Card className="gap-3 px-4 py-3">
        <CountedInput
          id="internal-form-name"
          label="Internal Form Name"
          value={draft.name}
          max={NAME_MAX}
          required
          placeholder="Session Submission Form"
          onChange={(value) => patch({ name: value })}
        />
        <WelcomeHeadingFields draft={draft} patch={patch} />
      </Card>

      <Card className="px-4 py-3">
        <RichTextEditor
          id="welcome-message"
          label="Welcome Message"
          value={draft.welcomeHtml}
          toggle={{
            label: 'Show message',
            checked: draft.welcomeEnabled,
            onCheckedChange: (checked) => patch({ welcomeEnabled: checked }),
          }}
          help="Shown at the top of the public form's first step."
          onChange={(html) => patch({ welcomeHtml: html })}
        />
      </Card>
    </div>
  )
}
