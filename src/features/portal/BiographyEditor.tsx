'use client'

// The dynamic-import boundary in front of TipTap.
//
// .claude/rules/bodo-conventions.md: "TipTap, @dnd-kit, and charts are dynamically
// imported at the component that needs them, never at a layout." This is the component
// that needs it, and it is the only place in the portal that does, so the ProseMirror
// bundle stays off the home page, the submissions list and the tasks page.
//
// `ssr: false` because the editor owns a contentEditable node: server-rendering it
// produces markup the client immediately replaces, which is a hydration mismatch on the
// first keystroke and a wasted payload either way.

// WHAT THE LOADING STATE HAS TO SAY, and why it is no longer a bare pair of skeletons.
//
// It used to render `0 / 5,000 characters` literally, so a speaker whose biography was still
// loading was shown an empty box under a counter reading zero, which is indistinguishable
// from having no biography at all. Dropping the counter fixed that lie and left a quieter
// one: an unlabelled grey block sitting where their biography is. The eval run of 2026-08-11
// measured that block at eight to ten seconds and filed the save control above it as broken,
// because a speaker who cannot see their own text works the page before it is ready. So this
// state now says three true things instead of nothing: that it is still loading, that
// nothing is editable yet, and WHAT THE BIOGRAPHY CURRENTLY SAYS.
//
// The existing text is rendered as TEXT, through `htmlToText`, never as markup. A biography
// is speaker input and this file ships to the browser, so it goes nowhere near an HTML sink;
// it is the same treatment the CFP wizard's Review step gives a stored answer.
//
// The context is what carries it there. `next/dynamic` renders its `loading` component with
// no props, but it renders it exactly where the editor would go, which is inside the
// provider below, so the placeholder can read the value the editor was handed. No module
// state, no mount effect, and no second copy of the biography in the payload.
//
// The hidden input carrying the value lives inside the editor chunk, so a save during this
// window posts no `bio` at all and `profileDraftFrom` leaves an unposted field alone instead
// of clearing it. The placeholder deliberately does NOT add one of its own: a value posted
// from here would be a save of text the speaker never had the chance to edit.

import dynamic from 'next/dynamic'
import { createContext, useContext } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { htmlToText } from '@/utils/html-text'

const InitialBiography = createContext('')

function BiographyLoading() {
  const text = htmlToText(useContext(InitialBiography))

  return (
    <div className="space-y-1.5">
      <div className="rounded-lg border border-input">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Skeleton className="h-5 w-40" />
        </div>
        {text === '' ? (
          <Skeleton className="m-3 h-24" />
        ) : (
          <p className="min-h-32 px-3 py-2 text-pretty text-sm whitespace-pre-line text-muted-foreground">
            {text}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Loading the editor</p>
    </div>
  )
}

const TipTapEditor = dynamic(() => import('@/features/portal/TipTapEditor'), {
  ssr: false,
  loading: () => <BiographyLoading />,
})

export function BiographyEditor({ name, initialHtml }: { name: string; initialHtml: string }) {
  return (
    <InitialBiography value={initialHtml}>
      <TipTapEditor name={name} initialHtml={initialHtml} />
    </InitialBiography>
  )
}
