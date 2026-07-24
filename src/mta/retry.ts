import type { RetryPolicy } from '../shared/types.js';

/**
 * Retry profiles per provider. Real MTAs tune these per destination because
 * each mailbox provider punishes differently: hammer Yahoo too fast and you
 * earn a TSS04 volume deferral; retry Gmail greylisting too slowly and you
 * just add latency for no reason.
 *
 * Baseline inspired by Postfix defaults (min 300s, max ~4000s, 5-day queue
 * lifetime), compressed here so the demo is watchable in minutes, not days.
 */
export const RETRY_POLICIES: Record<string, RetryPolicy> = {
  'fake-gmail': {
    baseSeconds: 5,
    factor: 2,
    maxSeconds: 60,
    maxAttempts: 6,
  },
  'fake-outlook': {
    baseSeconds: 15,
    factor: 2,
    maxSeconds: 120,
    maxAttempts: 5,
  },
  'fake-yahoo': {
    baseSeconds: 10,
    factor: 3,
    maxSeconds: 90,
    maxAttempts: 5,
  },
  default: {
    baseSeconds: 10,
    factor: 2,
    maxSeconds: 60,
    maxAttempts: 5,
  },
};

/** Exponential backoff with full jitter (AWS-style): avoids retry storms
 *  where every deferred message comes back at the exact same instant. */
export function nextDelaySeconds(policy: RetryPolicy, attempt: number): number {
  const exp = Math.min(
    policy.maxSeconds,
    policy.baseSeconds * policy.factor ** (attempt - 1),
  );
  return Math.round(Math.random() * exp) || 1;
}

export function policyFor(provider: string): RetryPolicy {
  return RETRY_POLICIES[provider] ?? RETRY_POLICIES.default;
}
