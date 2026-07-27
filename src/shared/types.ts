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
export const QUEUE_EVENTS = 'emails.events';

/**
 * Status events published by the API and the MTA, consumed by the writer —
 * the only process that writes to Postgres. The hot path never blocks on
 * the database; a Postgres outage delays bookkeeping, not delivery.
 */
export type StatusEvent =
  | { type: 'message.queued'; email: OutboundEmail }
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
