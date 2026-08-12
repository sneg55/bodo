// The Webhooks and WebhookDeliveries half of the column registry (design §5).
//
// Split out on the same seam, and for the same reason, as columns-crm.ts: `COL` is one
// object built by spreading these in, so every rule from tables.ts still applies. One name
// for one concept, and Airtable's own spelling never leaves this directory.
//
// `enabled`, `name`, `status`, `attempts`, `leaseHolder`, `leaseExpiresAt`, `lastError`,
// `sendAt`, `sentAt`, `payloadJson`, `idempotencyKey` and the `event` link are deliberately
// absent: all of them are already in `COL` and mean exactly the same thing here that they
// mean on EmailOutbox. A second spelling of a shared concept is what the one-registry rule
// exists to prevent, and the lease columns in particular have to read identically on both
// tables or the two drains would diverge on what a claim looks like.

export const COL_WEBHOOKS = {
  /** Where the POST goes. A Discord webhook URL is a first-class value here. */
  url: 'url',
  /**
   * The HMAC key the receiver verifies `X-Bodo-Signature` with.
   *
   * Stored on the row rather than derived from a global secret, because a shared key means
   * one organizer's endpoint can forge deliveries aimed at another's.
   */
  secret: 'secret',
  /**
   * The event types this subscription wants, as a JSON array of strings.
   *
   * A `...Json` blob rather than a multi-select, and that is a schema-types limit rather
   * than a preference: `MetaFieldType` in src/migrations/schema-types.ts has no
   * `multipleSelects` builder, so a multi-select cannot be declared at all today and a
   * migration that named a type the builders do not have would fail at apply time. The
   * DAL parses the array and validates each entry against WEBHOOK_EVENT_TYPES, which is
   * the same guarantee `requiredChoice` gives a select, just enforced one layer up.
   */
  subscribedEventsJson: 'subscribedEventsJson',
  /**
   * The last HTTP status this endpoint answered, as TEXT.
   *
   * Text and not a number because the interesting failures have no status: a timeout, a
   * DNS failure and a refused connection all matter to whoever is debugging their endpoint,
   * and a number column can only render those as empty, which reads as "never tried".
   */
  lastStatus: 'lastStatus',
  /** When this endpoint was last POSTed to, successfully or not. */
  lastAttemptAt: 'lastAttemptAt',
  /** WebhookDeliveries -> Webhooks. Singular: a delivery belongs to one subscription. */
  webhook: 'webhook',
  /**
   * Which of the four event types this delivery carries.
   *
   * NOT `eventType`, which is already in `COL` and means what kind of conference an Events
   * row is. Two concepts under one name is exactly the collision the registry header warns
   * about, and here it would put a webhook topic and a conference format in the same column
   * name on two tables.
   */
  webhookEvent: 'webhookEvent',
} as const

// The two table names are NOT here. They were, briefly, while this file was written by an
// agent that did not own `table-names.ts`; they now live there with every other table name,
// because a second place naming a table is a second registry free to disagree with the first,
// and the symptom of that disagreement is a table the DAL reads as missing.
