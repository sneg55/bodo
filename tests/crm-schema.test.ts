import { describe, expect, it } from 'vitest'

import { CRM_TABLES } from '@/migrations/tables-crm'
import { TABLES } from '@/services/airtable/tables'
import { speakerCommsTag, speakerTagsTag, userSpeakerListsTag } from '@/services/airtable/tags'

describe('crm schema', () => {
  it('declares both new tables', () => {
    const names = CRM_TABLES.map((table) => table.name)
    expect(names).toContain(TABLES.speakerTags)
    expect(names).toContain(TABLES.speakerLists)
  })

  it('leads each table with a legal primary field', () => {
    // Airtable forbids a link, select, or checkbox as the primary field.
    for (const table of CRM_TABLES) {
      expect(table.fields[0]?.type).toBe('singleLineText')
    }
  })

  it('namespaces its cache tags', () => {
    expect(speakerTagsTag()).toBe('speaker-tags')
    expect(userSpeakerListsTag('usr1')).toBe('user:usr1:speaker-lists')
    expect(speakerCommsTag('spk1')).toBe('speaker:spk1:comms')
  })
})
