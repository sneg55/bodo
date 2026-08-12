// The lint rule IS the regression test, so this is the test of the lint rule.
//
// `startTransition(() => { void (async () => ...)() })` ends the transition before the
// await, so `isPending` is false again in the same tick and every `disabled={pending}`
// derived from it is decoration. That is a double-submit hole anywhere, and a lost write in
// `SpeakerTagEditor`, where the handler computes its next tag set from a prop.
//
// It cannot be asserted against the components: vitest runs `environment: 'node'` here, with
// no renderer. Extracting the handler's logic does not help either, because a
// behaviour-preserving extraction passes against the broken version too. So the guarantee is
// a lint rule, and what is assertable is the rule: that it rejects the shape that shipped
// twice, and that it leaves the legitimate synchronous form alone.
//
// Running ESLint's `Linter` on source strings rather than reading the repo means this fails
// if the selector is loosened, tightened, or deleted, which is exactly what it is for.

import parser from '@typescript-eslint/parser'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'

import { REACT_CORRECTNESS_RESTRICTED_SYNTAX } from '../eslint.restricted-syntax.mjs'

const linter = new Linter()

function violations(code: string): number {
  return linter.verify(code, {
    languageOptions: { parser },
    rules: { 'no-restricted-syntax': ['error', ...REACT_CORRECTNESS_RESTRICTED_SYNTAX] },
  }).length
}

describe('the startTransition rule', () => {
  it('rejects the shape that shipped in SpeakerTagEditor and SavedViewsControl', () => {
    expect(violations('startTransition(() => { void (async () => { await save() })() })')).toBe(1)
  })

  it('rejects voiding an async call rather than an inline arrow, which fails the same way', () => {
    expect(violations('startTransition(() => { void save() })')).toBe(1)
  })

  it('catches it however deeply the void is nested in the scope', () => {
    expect(violations('startTransition(() => { if (ready) { void save() } })')).toBe(1)
  })

  it('accepts the async scope, which is the fix', () => {
    expect(violations('startTransition(async () => { await save() })')).toBe(0)
  })

  it('leaves a synchronous transition alone, which is what the sync form is for', () => {
    expect(violations('startTransition(() => setPage(2))')).toBe(0)
    expect(violations('startTransition(() => { setPage(2); setOpen(false) })')).toBe(0)
  })

  it('does not fire on a void outside a transition', () => {
    // `invalidate.ts` has `void origin` to mark a deliberately unread parameter.
    expect(violations('function invalidate(origin) { void origin }')).toBe(0)
  })

  it('carries a message naming the correct shape, since that is what an agent reads', () => {
    const messages = REACT_CORRECTNESS_RESTRICTED_SYNTAX.map((rule) => rule.message)
    expect(messages.join('\n')).toContain('startTransition(async () =>')
  })
})
