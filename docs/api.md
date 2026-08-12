# API

bodo exposes its published data three ways. The REST API and the MCP server are inbound and
share one bearer token and one scope; webhooks are outbound and carry their own per-
subscription signing secret.

A copy-paste reference, including the `claude mcp add` line, is served by the running app at
`/docs/api`.

## Tokens

`/admin/<event>/settings/api` mints tokens.

- The plaintext is shown **once**, at creation. The row stores a SHA-256 digest and never the
  value.
- Revocation takes effect on the **next request**, because the authentication read is
  deliberately uncached.
- Reach comes from the owner's `EventMemberships` **on every request**, never from the token
  row. Removing someone from an event removes their tokens' access to it, without touching
  the tokens.

Authenticate with a bearer token:

```bash
curl -H "Authorization: Bearer $BODO_TOKEN" https://<host>/api/v1/events
```

An unauthenticated request answers `401` with `WWW-Authenticate: Bearer realm="bodo"` and a
JSON body carrying an error id.

## REST

| Endpoint | Returns |
|---|---|
| `GET /api/v1/events` | The events the token's owner can reach |
| `GET /api/v1/events/{slug}/sessions` | Published sessions for one event |
| `GET /api/v1/events/{slug}/speakers` | Speakers on published sessions |

Paginated with `page` and `size` (default 25, max 100; asking for more gets the max rather
than an error), answering:

```json
{ "data": [ ... ], "page": 1, "size": 25, "total": 137 }
```

**Only published agenda rows are exposed.** The API reads the same projection as the public
pages and the embeds, so there is exactly one definition of "public" in the codebase and an
unpublished session cannot leak through a second door.

Not built, and named rather than left as a silent gap: contacts as a resource, and search.
Both exist in the reference product's API.

## MCP

`POST /api/v1/mcp` is a Model Context Protocol server over the same bearer token. Four tools:

| Tool | Answers |
|---|---|
| `list_events` | Which events can I see? |
| `list_sessions` | What is on the programme? |
| `list_speakers` | Who is speaking? |
| `outstanding_tasks` | Who still owes me something? |

**All read-only, and that is a product decision rather than a limitation.** An agent that can
accept a submission or email a speaker on its own is not something an organizer can safely
point at a live conference the week of the event. What they do want is the answer to "who
still owes me a headshot" without opening a browser.

Every tool wraps a function that already exists and is already used by a screen, so an answer
here cannot drift from what the admin UI shows: sessions come from the same published-agenda
read as the public embeds, and `outstanding_tasks` is the same resolution the Tasks page and
the reminder sweep both use.

`/admin/<event>/settings/mcp` is the setup page: mint a token, copy the four values into your
client, and press a button that checks the connection actually works.

## Webhooks

Outbound, registered per event at `/admin/<event>/settings/webhooks`.

Events: `submission.created`, `submission.status_changed`, `task.completed`,
`session.published`.

Headers on every delivery:

| Header | Meaning |
|---|---|
| `X-Bodo-Event` | Which event type this is |
| `X-Bodo-Signature` | HMAC over the exact body, using the subscription's secret |
| `X-Bodo-Delivery` | Idempotency key; drop a repeat you have already processed |

Delivery is queued and drained by cron, with retries and a terminal dead state. The **body is
snapshotted at enqueue** so a retry sends what happened rather than what is true now, and the
**endpoint is read at send time** so a rotated secret signs the retry with the key the
receiver is verifying with today.

Verify a delivery by computing the same HMAC over the raw body you received, before parsing
it.

## Errors

Every failure the API raises deliberately carries an id from a central registry
(`src/constants/errorIds.ts`), so a message can change without breaking a client that branches
on the id. An unexpected exception is not dressed up as one of these; it surfaces as the
runtime's own error response.

```json
{ "error": { "id": "E_AUTH_004", "message": "invalid or missing token" } }
```
