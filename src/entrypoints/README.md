# Entrypoints

`worker.ts` is what `wrangler.jsonc` points `main` at. It is not optional glue:
the OpenNext-generated `.open-next/worker.js` exports only `fetch`, and Cloudflare
will not deliver a Cron Trigger to a Worker with no `scheduled()` handler, so
without this file the crons in `wrangler.jsonc` would be declared and never fire.

It does three things and nothing else:

1. Delegates every request to the generated Next worker, unchanged.
2. Re-exports the Durable Object classes, because wrangler resolves DO
   `class_name` against the entry module: `DOQueueHandler`, `DOShardedTagCache`,
   `BucketCachePurge` from OpenNext, plus our own `ClaimGuard`.
3. Maps each cron expression to a route and calls the Next handler in process
   with a constructed Request. In process, not over the network: no DNS, no TLS,
   no public route. It goes through the Next handler rather than importing the job
   directly because a job that writes has to invalidate cache tags, and the cache
   APIs only work inside the Next server context.

Job logic lives in `src/features/jobs/`, so a schedule and the admin "run now"
button land on the same function and it stays testable from neither entry.

`open-next-worker.d.ts` is the type shim for the generated bundle, which does not
exist until `npm run cf:build` has run.
