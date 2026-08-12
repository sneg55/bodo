'use client'

// The copy control the MCP setup steps share.
//
// Every value on that page is one an organizer has to move into another application byte for
// byte: an endpoint, a header, and a token they will never be shown again. Typing any of them
// out is how a setup fails with no error message, so each one gets a button.
//
// Local to this feature rather than promoted to `src/components/primitives`. Six hand-rolled
// copy buttons already exist across the app (WebhooksPanel, InviteLinkButton, EmbedPreviewPanel,
// CopyFileLinkButton, FormEditor, ApiTokensPanel) and unifying them is a separate change to
// those six files, not a thing to do on the way past.

import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

export function McpCopyButton({
  value,
  label,
  size = 'icon',
}: {
  value: string
  /** What was copied, named in the toast: an organizer copies four things in a row here. */
  label: string
  size?: 'icon' | 'sm'
}) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      variant="outline"
      size={size}
      aria-label={`Copy ${label.toLowerCase()}`}
      onClick={() => {
        void navigator.clipboard.writeText(value)
        toast.success(`${label} copied`)
        // The tick is the acknowledgement that survives the toast, which is gone in four
        // seconds while the organizer is still tabbing to their editor.
        setCopied(true)
        setTimeout(() => {
          setCopied(false)
        }, 2000)
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {size === 'sm' ? (copied ? 'Copied' : 'Copy') : null}
    </Button>
  )
}
