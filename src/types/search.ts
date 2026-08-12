// What the global search palette hands to the UI.
//
// Here rather than next to either side of it, because the shape crosses a boundary the
// other direction would not survive: `src/features/search/actions.ts` is `'use server'`
// and `src/components/shell/GlobalSearch.tsx` is `'use client'`, so neither can own the
// type without the other importing across a directive.

export type GlobalSearchItem = {
  readonly id: string
  /** The line the palette matches on and shows first. */
  readonly label: string
  /** Second line, right-aligned: a session code, a speaker's email, a row count. */
  readonly description?: string
  readonly href: string
  /**
   * Everything else this row was matched ON, for cmdk's own filter to see.
   *
   * cmdk re-filters the picked set on the client against each item's `value`, and the
   * palette builds that value out of the label and the description alone. So a submission
   * matched on a PARTICIPANT's name was selected by the server and then silently dropped in
   * the browser, because the name appears in neither the title nor the code. Searching a
   * speaker therefore returned the speaker and none of their talks.
   *
   * Not shown anywhere. It exists so the client filter agrees with the server one.
   */
  readonly keywords?: string
}

export type GlobalSearchGroup = {
  readonly id: string
  readonly label: string
  readonly items: readonly GlobalSearchItem[]
}
