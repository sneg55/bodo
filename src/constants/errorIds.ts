// Central error ID registry. See guides/error-id-registry.md.
//
// Rules:
//   1. Never reuse a retired ID - mark it `// retired` and leave it in place.
//   2. One ID per distinct cause, not per throw site.
//   3. Numbers are stable; append, never renumber.
//   4. Domain prefix (3 to 5 letters) is required.
//
// Throw via AppError(ErrorIds.X, '...', { context }). Log lines include the ID
// so grep, telemetry, and agents can all find every occurrence with one search.

export const ErrorIds = {
  // ── Config (CFG) ─────────────────────────────────────────────────────────
  CFG_MISSING: 'E_CFG_001',
  CFG_INVALID_JSON: 'E_CFG_002',
  CFG_SCHEMA_FAIL: 'E_CFG_003',
  CFG_ENV_MISSING: 'E_CFG_004',
  CFG_BINDING_MISSING: 'E_CFG_005',
  // A binding that IS present and answered with a failure. Distinct from
  // CFG_BINDING_MISSING on purpose: one is a deploy that was configured wrong and
  // one is a runtime fault, and collapsing them makes the logs unable to tell a
  // misconfiguration from a Durable Object that is misbehaving.
  CFG_BINDING_FAILED: 'E_CFG_006',
  // APP_URL does not match the origin the Worker is actually answering on, so
  // every link this deployment generates (embed snippets, magic links, portal
  // links, .ics URLs) points somewhere nothing is listening.
  CFG_ORIGIN_MISMATCH: 'E_CFG_007',

  // ── Network (NET) ────────────────────────────────────────────────────────
  NET_TIMEOUT: 'E_NET_001',
  NET_DNS: 'E_NET_002',
  NET_TLS: 'E_NET_003',
  NET_RATE_LIMITED: 'E_NET_004',
  NET_UNAVAILABLE: 'E_NET_005',
  NET_BAD_SHAPE: 'E_NET_006',

  // ── Airtable data layer (DATA) ───────────────────────────────────────────
  DATA_RECORD_NOT_FOUND: 'E_DATA_001',
  DATA_SHAPE_INVALID: 'E_DATA_002', // record failed its Zod schema on read
  DATA_WRITE_FAIL: 'E_DATA_003',
  DATA_RATE_LIMITED: 'E_DATA_004', // Airtable 5 req/s per base
  DATA_MISSING_LINK: 'E_DATA_005', // linked record id points at nothing

  // ── Auth and sessions (AUTH) ─────────────────────────────────────────────
  AUTH_TOKEN_INVALID: 'E_AUTH_001',
  AUTH_TOKEN_EXPIRED: 'E_AUTH_002',
  AUTH_TOKEN_REUSED: 'E_AUTH_003', // jti already in the KV denylist
  AUTH_NO_SESSION: 'E_AUTH_004',
  AUTH_FORBIDDEN_ROLE: 'E_AUTH_005',
  AUTH_UNKNOWN_ADMIN: 'E_AUTH_006', // magic link requested for a non-AdminUsers email
  // An impersonation entry or exit that does not describe a real situation: entering the
  // portal for an event the portal does not serve, or leaving a session that never was
  // impersonation. Distinct from AUTH_FORBIDDEN_ROLE, which is the caller lacking a role:
  // this one is a request that could not be honoured for anybody.
  AUTH_IMPERSONATION_INVALID: 'E_AUTH_007',
  // A demo persona that cannot be signed in as: DEMO_*_EMAIL names an address with no
  // Speakers or AdminUsers row, or the admin it names holds no event membership to land
  // on. Always an operator mistake in the demo configuration and never anything the
  // visitor did, so /login says so plainly instead of blaming the address, which no
  // visitor typed. Distinct from AUTH_UNKNOWN_ADMIN, where a stranger typed the address
  // and must not learn whether it exists.
  AUTH_DEMO_IDENTITY_MISSING: 'E_AUTH_008',

  // ── Submissions and forms (SUB) ──────────────────────────────────────────
  SUB_FORM_CLOSED: 'E_SUB_001', // past close date
  SUB_LIMIT_REACHED: 'E_SUB_002', // per-user submission cap, drafts included
  SUB_VALIDATION_FAIL: 'E_SUB_003',
  SUB_ROLE_COUNT_INVALID: 'E_SUB_004', // participant role min/max violated
  SUB_ILLEGAL_TRANSITION: 'E_SUB_005', // status change the lifecycle disallows
  // A speaker edit refused because the submission body is read-only (§5.2). Distinct
  // from SUB_FORM_CLOSED, which is about the form's deadline: this one also covers a
  // decided submission on a form that is still wide open.
  SUB_BODY_LOCKED: 'E_SUB_006',
  // Asked what a decision would send for a row that is in neither queue, so there is no
  // decision to render. Distinct from SUB_ILLEGAL_TRANSITION, which refuses a WRITE: this
  // one refuses a read-only preview and nothing was going to change either way.
  SUB_NOT_STAGED: 'E_SUB_007',
  // A staged row whose decision has nobody to address. An accept mails every participant
  // and a decline mails the submitter alone, so this is a roster the send would also skip;
  // reporting it as its own cause stops it reading as a template or transport fault.
  SUB_NO_RECIPIENTS: 'E_SUB_008',
  // A public submit whose email address already names a Speakers row, from a visitor who
  // has not proved they are that person. NOT an authentication failure: a CFP is open to
  // strangers by design and a fresh address is accepted with no account at all. What is
  // refused is BINDING an anonymous submission to a record that already exists, because
  // `upsertSpeakerByEmail` updates that row and would write the visitor's name and bio over
  // the real speaker's, and because the submission would then appear in that person's
  // portal as theirs. Distinct from AUTH_NO_SESSION, which would claim the CFP needs a
  // login.
  SUB_UNVERIFIED_SUBMITTER: 'E_SUB_009',

  // ── Uploads (FILE) ───────────────────────────────────────────────────────
  FILE_TOO_LARGE: 'E_FILE_001',
  FILE_TYPE_REJECTED: 'E_FILE_002',
  FILE_UPLOAD_FAIL: 'E_FILE_003',

  // ── Email and calendar (MAIL) ────────────────────────────────────────────
  MAIL_SEND_FAIL: 'E_MAIL_001',
  MAIL_TEMPLATE_MISSING: 'E_MAIL_002',
  MAIL_MERGE_FIELD_UNKNOWN: 'E_MAIL_003',
  MAIL_ICS_INVALID: 'E_MAIL_004',

  // ── Accelevents sync (ACCEL) ─────────────────────────────────────────────
  ACCEL_AUTH_FAIL: 'E_ACCEL_001',
  ACCEL_DUPLICATE_EMAIL: 'E_ACCEL_002', // their error 4068906, treated as "exists"
  ACCEL_BAD_REQUEST: 'E_ACCEL_003',
  ACCEL_UNAVAILABLE: 'E_ACCEL_004',

  // ── LLM / API (LLM), P2 AI review ────────────────────────────────────────
  LLM_RATE_LIMITED: 'E_LLM_001',
  LLM_CONTEXT_OVERFLOW: 'E_LLM_002',
  LLM_BAD_RESPONSE: 'E_LLM_003',
  // The model's safety classifiers declined the request: HTTP 200, `stop_reason:
  // "refusal"`, and content that is empty or a partial nobody should read. Distinct from
  // LLM_BAD_RESPONSE, which is a well-formed attempt this code could not parse. A refusal
  // is a decision, so it is reported as one and never rendered as an answer.
  LLM_REFUSED: 'E_LLM_004',
  // The remote call itself failed: transport, auth, or a non-2xx the SDK raised. Kept
  // apart from LLM_RATE_LIMITED so a quota problem does not read as an outage.
  LLM_UNAVAILABLE: 'E_LLM_005',
  // A feature asked for a live model on a deployment that has no key. Only reachable if
  // the env pairing in src/utils/env.ts is bypassed, which is why it names the flag.
  LLM_NOT_CONFIGURED: 'E_LLM_006',

  // ── Speaker CRM import (CRM) ─────────────────────────────────────────────
  CRM_UPLOAD_TOO_LARGE: 'E_CRM_001',
  CRM_CSV_UNPARSEABLE: 'E_CRM_002',
  CRM_NO_MAPPABLE_COLUMNS: 'E_CRM_003', // no header maps to a required field (email)
  CRM_ROW_CAP_EXCEEDED: 'E_CRM_004', // more rows than IMPORT_ROW_CAP
  CRM_COMMIT_PARTIAL: 'E_CRM_005',
  // A batch handed to the import write while still repeating an email. Always a caller bug -
  // a hand-built batch claiming a property its rows do not have - never anything the organizer
  // uploaded: a real file's repeats are dropped by `dedupeRows` and reported in the summary.
  // Thrown only from tests/helpers/deduped-batch.ts, which is the only place that can claim it.
  CRM_BATCH_NOT_DEDUPED: 'E_CRM_006',
  // A commit whose submission id has already been claimed: the same import arriving twice,
  // which `claimOnce` refused. Distinct from DATA_WRITE_FAIL and that is the whole point: the
  // wizard mints a fresh submission id after a failed commit so a genuine failure can be
  // retried, and doing that here would hand the next press a key the guard has never seen and
  // undo the guard. The client tells the two apart by this id.
  CRM_IMPORT_ALREADY_CLAIMED: 'E_CRM_007',

  // Add new domains/IDs below. Keep the comment block above each domain.
} as const

export type ErrorId = (typeof ErrorIds)[keyof typeof ErrorIds]

export class AppError extends Error {
  readonly id: ErrorId
  readonly context: Record<string, unknown>

  constructor(id: ErrorId, message: string, context: Record<string, unknown> = {}) {
    super(message)
    this.id = id
    this.context = context
    this.name = 'AppError'
  }

  toLogLine(): string {
    const ctx = Object.entries(this.context)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ')
    return `[${this.id}] ${this.message}${ctx ? ` ${ctx}` : ''}`
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}
