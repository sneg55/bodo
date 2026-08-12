// Type shim for the OpenNext-generated Worker.
//
// `.open-next/worker.js` only exists after `npm run cf:build`, and it is
// gitignored, so a fresh clone has no file for TypeScript to resolve. Without
// this declaration `tsc --noEmit` fails on the entrypoint's import before any
// build has run. The generated module's real shape is a default export with a
// `fetch` method plus the three Durable Object classes; the classes are opaque
// here because nothing in this repo constructs them, it only re-exports them so
// wrangler can find them from `main`.

declare module '*/.open-next/worker.js' {
  const handler: {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>
  }
  export default handler
  export const DOQueueHandler: unknown
  export const DOShardedTagCache: unknown
  export const BucketCachePurge: unknown
}
