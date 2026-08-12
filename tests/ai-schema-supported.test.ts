// Every JSON schema sent to structured output must use only keywords the API accepts.
//
// This exists because of a failure that no test could see and the mock could not reproduce.
// `ASK_SCHEMA` carried `maxItems` on its `refs` array and the dashboard proposal carried
// `minItems` and `maxItems` on its `metrics` array. Under the default `AI_MOCK=1` nothing
// ever validated them, because the mock never sends a schema anywhere. The moment
// `AI_MOCK` went to `0` on the deployed Worker, every ask and every proposal failed with:
//
//   400 invalid_request_error
//   output_config.format.schema: For 'array' type, property 'maxItems' is not supported
//
// and the surface reported only "the model API call failed", which is indistinguishable
// from a rejected key or an outage. So the schemas are now checked here, walked recursively,
// against the keywords structured output is known to reject. A new schema, or a new keyword
// added to an existing one, fails in CI instead of in front of an organizer.
//
// The banned list is deliberately the empirically-confirmed one plus the array-length pair
// it belongs to, not a guess at the full grammar. `maxItems` is confirmed by the 400 above;
// `minItems` travelled with it and its support is unverified, which is reason enough not to
// be the only caller relying on it. Add to this list when the API rejects something else,
// and cite the error when you do.

import { describe, expect, it } from 'vitest'
import { ASK_SCHEMA } from '@/features/ai/ask'
import { PROPOSAL_SCHEMA } from '@/features/dashboard/ai-proposal'

/** Keywords structured output refuses. See the header for what confirmed each one. */
const UNSUPPORTED_KEYWORDS: readonly string[] = ['maxItems', 'minItems']

/** Every keyword name appearing anywhere in a schema, at any depth. */
function keywordsIn(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const entry of node) keywordsIn(entry, found)
    return found
  }
  if (typeof node !== 'object' || node === null) return found

  for (const [key, value] of Object.entries(node)) {
    found.add(key)
    keywordsIn(value, found)
  }
  return found
}

const SCHEMAS: readonly { name: string; schema: Record<string, unknown> }[] = [
  { name: 'ASK_SCHEMA', schema: ASK_SCHEMA },
  { name: 'PROPOSAL_SCHEMA', schema: PROPOSAL_SCHEMA },
]

describe('the schemas sent to structured output', () => {
  for (const { name, schema } of SCHEMAS) {
    it(`${name} uses no keyword the API rejects`, () => {
      const used = keywordsIn(schema)
      const banned = UNSUPPORTED_KEYWORDS.filter((keyword) => used.has(keyword))

      expect(banned, `${name} carries ${banned.join(', ')}`).toEqual([])
    })

    it(`${name} still declares an object with required properties`, () => {
      // Guards the fix in the other direction: deleting the offending keyword by deleting
      // the property, or the whole schema, would also make this file pass.
      expect(schema.type).toBe('object')
      expect(Array.isArray(schema.required)).toBe(true)
      expect((schema.required as readonly unknown[]).length).toBeGreaterThan(0)
      expect(schema.additionalProperties).toBe(false)
    })
  }

  it('walks nested schemas rather than only the top level', () => {
    // The real bug was two levels down, inside `properties.refs`. A check that only read
    // the root object would have passed while the deployed ask was failing every call.
    const nested = { type: 'object', properties: { a: { type: 'array', maxItems: 3 } } }

    expect(keywordsIn(nested).has('maxItems')).toBe(true)
  })
})
