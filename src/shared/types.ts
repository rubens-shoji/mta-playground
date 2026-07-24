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
