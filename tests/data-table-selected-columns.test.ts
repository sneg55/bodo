// The Preferences drawer's "Selected (n)" pane, rendered against the speaker CRM catalog.
//
// This pane is why the catalog became a prop and it was also the one component the change
// missed. It labelled its chips with `registryField(key)`, a lookup over every field in the
// app, which on a table of PEOPLE resolves four of the seven default keys to nothing (they
// render as raw `eventCount`) and resolves `tags` to the SESSION tag field, so a chip read
// "Tags" while the header one pane over read "Speaker Tags".
//
// Rendered to static markup rather than through a DOM: this repo has no jsdom and no
// testing-library, and adding a browser stack to assert seven strings would be a bigger
// change than the fix. Static markup is enough, because what broke is what the component
// PRINTS.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DataTableSelectedColumns } from '@/components/primitives/DataTableSelectedColumns'
import { SESSION_CATALOG } from '@/components/primitives/data-table-types'
import {
  SPEAKER_CRM_CATALOG,
  SPEAKER_CRM_DEFAULT_COLUMN_KEYS,
} from '@/constants/speaker-crm-fields'

function markup(columnKeys: readonly string[], fields = SPEAKER_CRM_CATALOG.fields): string {
  return renderToStaticMarkup(
    createElement(DataTableSelectedColumns, {
      columnKeys,
      fields,
      onReorder: () => undefined,
      onRemove: () => undefined,
    }),
  )
}

describe('the selected-columns pane', () => {
  it('labels a CRM-only column from the CRM catalog, not the global registry', () => {
    const html = markup(['eventCount', 'sessionCount', 'name'])
    expect(html).toContain('Events')
    expect(html).toContain('Sessions')
    expect(html).toContain('Name')
    // The bug's signature: no catalog entry found, so the raw key reached the screen.
    expect(html).not.toContain('eventCount')
  })

  it('reads a key that means two things from the catalog it was handed', () => {
    // `tags` is Tags on a table of submissions and Speaker Tags on a table of people. The
    // global registry only knows the first, and answering with it here was the exact
    // collision the catalog prop exists to prevent.
    expect(markup(['tags'])).toContain('Speaker Tags')
    expect(markup(['tags'], SESSION_CATALOG.fields)).not.toContain('Speaker Tags')
  })

  it('labels every column the CRM opens with', () => {
    const html = markup(SPEAKER_CRM_DEFAULT_COLUMN_KEYS)
    for (const key of SPEAKER_CRM_DEFAULT_COLUMN_KEYS) {
      // No default key may reach the pane unlabelled. Asserted per key rather than as one
      // blob so a failure names the column that regressed.
      expect(html).not.toContain(`>${key}<`)
    }
  })

  it('falls back to the raw key for a key no catalog owns, rather than rendering blank', () => {
    // A stored column preference outlives any one catalog. An unlabelled chip is still
    // draggable and removable, which is what the organizer needs to get rid of it.
    expect(markup(['nope'])).toContain('nope')
  })
})
