import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Persistence model, written ONLY by the writer process (src/writer):
 *
 *  - messages: one row per accepted send, with its execution status.
 *    "bounced" covers permanent rejections, exhausted retries and
 *    unroutable domains — that's what a real sender reports back.
 *  - delivery_attempts: one row per SMTP conversation, including the
 *    raw response, so the deferral/retry saga is visible history.
 *  - suppressions: recipient-level do-not-send list. 5.7.x reputation
 *    blocks never land here (sender problem, not the address).
 */

export const messageStatus = pgEnum('message_status', [
  'queued',
  'deferred',
  'delivered',
  'bounced',
  'suppressed',
]);

export const attemptOutcome = pgEnum('attempt_outcome', [
  'delivered',
  'transient',
  'permanent',
]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey(),
  from: text('from').notNull(),
  to: text('to').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: messageStatus('status').notNull().default('queued'),
  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const deliveryAttempts = pgTable('delivery_attempts', {
  id: serial('id').primaryKey(),
  messageId: uuid('message_id')
    .notNull()
    .references(() => messages.id),
  attempt: integer('attempt').notNull(),
  provider: text('provider').notNull(),
  code: integer('code'),
  enhancedCode: text('enhanced_code'),
  response: text('response'),
  outcome: attemptOutcome('outcome').notNull(),
  retryInSeconds: integer('retry_in_seconds'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const placementFolder = pgEnum('placement_folder', ['inbox', 'spam']);

/** Where accepted mail actually landed, as reported by the providers via
 *  message.accepted events — accepted (250) ≠ inbox placement. message_id
 *  is nullable: mail sent outside the MTA carries no id header. */
export const placements = pgTable('placements', {
  id: serial('id').primaryKey(),
  messageId: uuid('message_id').references(() => messages.id),
  provider: text('provider').notNull(),
  from: text('from').notNull(),
  to: text('to').notNull(),
  folder: placementFolder('folder').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const suppressions = pgTable('suppressions', {
  address: text('address').primaryKey(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
