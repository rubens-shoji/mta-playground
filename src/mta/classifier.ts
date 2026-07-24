import type { DeliveryOutcome } from '../shared/types.js';

/**
 * Classify an SMTP response into a delivery outcome.
 *
 * The naive approach is "4xx = transient, 5xx = permanent". Real providers
 * break that rule constantly, so the TEXT can override the CODE:
 *
 *  - Yahoo TSS11 arrives as 553 but says "Retrying will NOT succeed"
 *    (permanent, and the code alone won't tell you).
 *  - Outlook 554 5.2.122 is a per-hour recipient limit: retriable tomorrow,
 *    despite the 5xx code.
 *  - Enhanced status codes (RFC 3463) refine the class: 5.1.1 (user unknown)
 *    should suppress the address; 5.7.x is a policy/reputation problem on
 *    the SENDER side.
 */

const ENHANCED_CODE_RE = /\b(\d\.\d{1,3}\.\d{1,3})\b/;

/** Text markers that force PERMANENT regardless of code. */
const PERMANENT_TEXT = [
  /retrying will not succeed/i,
  /this user doesn't have a .* account/i,
  /account that you tried to reach does not exist/i,
  /mailbox is disabled/i,
];

/** Text markers that force TRANSIENT despite a 5xx code. */
const TRANSIENT_TEXT = [
  /exceeded their limit for the number of messages they can receive per hour/i,
  /exceeded the limit for the number of messages they can send to this recipient per hour/i,
];

export function classify(
  provider: string,
  raw: string | null,
  code: number | null,
): DeliveryOutcome {
  // Connection dropped / no response at all: retry, carefully.
  if (raw === null || code === null) {
    return {
      kind: 'transient',
      code: null,
      enhancedCode: null,
      message: 'connection closed without response',
      provider,
    };
  }

  const enhanced = raw.match(ENHANCED_CODE_RE)?.[1] ?? null;
  const base: DeliveryOutcome = {
    kind: 'transient',
    code,
    enhancedCode: enhanced,
    message: raw.trim(),
    provider,
  };

  // 1. Text overrides first — providers contradict their own codes.
  if (PERMANENT_TEXT.some((re) => re.test(raw)))
    return { ...base, kind: 'permanent' };
  if (TRANSIENT_TEXT.some((re) => re.test(raw)))
    return { ...base, kind: 'transient' };

  // 2. Code classes.
  if (code >= 200 && code < 300) return { ...base, kind: 'delivered' };
  if (code >= 400 && code < 500) return { ...base, kind: 'transient' };
  if (code >= 500) return { ...base, kind: 'permanent' };

  // 3. Anything else (1xx/3xx mid-dialogue shouldn't reach us): be safe.
  return base;
}

/** Should this address go to the suppression list? Only for recipient-level
 *  permanent failures — NOT for sender reputation blocks (5.7.x), where the
 *  address is fine and WE are the problem. */
export function shouldSuppress(outcome: DeliveryOutcome): boolean {
  if (outcome.kind !== 'permanent') return false;
  if (outcome.enhancedCode?.startsWith('5.7.')) return false;
  return true;
}
