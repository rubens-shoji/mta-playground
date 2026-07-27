export interface OutboundEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  attempt: number;
  queuedAt: string;
}

export type OutcomeKind = 'delivered' | 'transient' | 'permanent';

export interface DeliveryOutcome {
  kind: OutcomeKind;
  code: number | null;
  enhancedCode: string | null;
  message: string;
  provider: string;
}

export interface RetryPolicy {
  /** first retry delay in seconds */
  baseSeconds: number;
  /** exponential factor */
  factor: number;
  /** cap for a single delay */
  maxSeconds: number;
  /** stop retrying after this many attempts */
  maxAttempts: number;
}

export const QUEUE_OUTBOUND = 'emails.outbound';
export const QUEUE_RETRY_PREFIX = 'emails.retry.'; // + delay bucket
export const EXCHANGE_EVENTS = 'emails.events'; // fanout
export const QUEUE_EVENTS_WRITER = 'emails.events.writer';

/** Header the MTA stamps on outgoing mail so providers can report inbox
 *  placement back by message id — like real seed-list tracking. */
export const MESSAGE_ID_HEADER = 'X-MTA-Message-Id';

/**
 * Status events published by the API, the MTA and the providers to the
 * emails.events fanout exchange. The writer — the only process that writes
 * to Postgres — consumes them from its durable queue; the API relays the
 * same stream to dashboards over SSE via an exclusive queue per client.
 * The hot path never blocks on the database; a Postgres outage delays
 * bookkeeping, not delivery.
 */
export type StatusEvent =
  | { type: 'message.queued'; email: OutboundEmail }
  | {
      type: 'message.accepted';
      messageId: string | null;
      provider: string;
      from: string;
      to: string;
      folder: 'inbox' | 'spam';
    }
  | {
      type: 'delivery.attempted';
      messageId: string;
      attempt: number;
      provider: string;
      code: number | null;
      enhancedCode: string | null;
      response: string | null;
      outcome: OutcomeKind;
      retryInSeconds: number | null;
      status: 'deferred' | 'delivered' | 'bounced';
    }
  | { type: 'message.suppressed'; messageId: string }
  | { type: 'address.suppressed'; address: string; reason: string };
