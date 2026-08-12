// The one sentence every surface uses to say that what it is showing was canned.
//
// **It lives in its own module so a client component can import it.** It started life in
// `./index.ts`, next to `liveClient`, and that made it a trap: `index.ts` pulls in
// `client.ts`, which pulls in `@anthropic-ai/sdk`, so a `'use client'` file importing this
// string shipped 462 KB of SDK to the browser. Two separate agents building two separate
// surfaces both hit it and both worked around it by passing the string down from a server
// action instead. Nothing about a constant should require that, so the constant moved.
//
// `index.ts` re-exports it for server callers, which is the convenient import there and
// costs nothing, since those files already have the SDK in their graph.

// **It names the flag and diagnoses nothing.** It used to say that no AI key was configured,
// which is not what selects the sample: `AI_MOCK` is, and .env.example deliberately supports
// running with `AI_MOCK=1` while a key is set. On that deployment the old sentence told the
// organizer something false on all three surfaces it renders on.

export const AI_SAMPLE_NOTICE = 'Sample output. This deployment runs with AI_MOCK=1.'
