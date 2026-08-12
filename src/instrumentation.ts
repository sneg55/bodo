// Server error reporting.
//
// OpenNext returns a bare "Internal Server Error" with no detail, which makes a
// runtime-only failure on Workers almost impossible to diagnose from the outside.
// `onRequestError` is Next's hook for exactly that: it fires with the real error, and
// `console.error` is one of the two console methods Biome permits, so it lands in
// `wrangler tail` and in the local preview log.
//
// This is not debug scaffolding to delete later. A deployed Worker with no error
// reporting is a Worker whose failures are invisible.

import type { Instrumentation } from 'next'

export const onRequestError: Instrumentation.onRequestError = (error, request) => {
  const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const stack = error instanceof Error ? (error.stack ?? '') : ''
  console.error(`[request-error] ${request.method} ${request.path}\n${details}\n${stack}`)
}
