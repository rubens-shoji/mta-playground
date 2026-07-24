import { describe, expect, it } from 'vitest';
import { classify, shouldSuppress } from './classifier.js';

/** Real-world responses from Google's official error table, Yahoo's sender
 *  hub and the SMTP Field Manual. The classifier must survive providers
 *  contradicting their own status codes. */

describe('classifier', () => {
  it('250 is delivered', () => {
    const o = classify('fake-gmail', 'OK 250 2.0.0 - gsmtp', 250);
    expect(o.kind).toBe('delivered');
  });

  it('Gmail greylisting 421 4.7.0 is transient', () => {
    const o = classify(
      'fake-gmail',
      '4.7.0 Try again later, closing connection. - gsmtp',
      421,
    );
    expect(o.kind).toBe('transient');
    expect(o.enhancedCode).toBe('4.7.0');
  });

  it('Gmail 421 4.7.28 rate limit is transient', () => {
    const o = classify(
      'fake-gmail',
      '4.7.28 Our system has detected an unusual rate of unsolicited mail originating from your IP address. - gsmtp',
      421,
    );
    expect(o.kind).toBe('transient');
  });

  it('Gmail 550 5.1.1 user unknown is permanent and suppressible', () => {
    const o = classify(
      'fake-gmail',
      '5.1.1 The email account that you tried to reach does not exist. - gsmtp',
      550,
    );
    expect(o.kind).toBe('permanent');
    expect(shouldSuppress(o)).toBe(true);
  });

  it('Gmail 550 5.7.1 reputation block is permanent but NOT suppressible (sender problem, not recipient)', () => {
    const o = classify(
      'fake-gmail',
      '5.7.1 Our system has detected an unusual rate of unsolicited mail. To protect our users from spam, mail has been blocked. - gsmtp',
      550,
    );
    expect(o.kind).toBe('permanent');
    expect(shouldSuppress(o)).toBe(false);
  });

  it('Yahoo TSS11: 553 whose TEXT says retrying will not succeed → permanent (text beats code ambiguity)', () => {
    const o = classify(
      'fake-yahoo',
      '5.7.2 [TSS11] All messages from 203.0.113.9 will be permanently deferred; Retrying will NOT succeed.',
      553,
    );
    expect(o.kind).toBe('permanent');
  });

  it('Yahoo TSS04 volume deferral is transient', () => {
    const o = classify(
      'fake-yahoo',
      '4.7.0 [TSS04] Messages from 203.0.113.9 temporarily deferred due to unexpected volume or user complaints',
      421,
    );
    expect(o.kind).toBe('transient');
  });

  it('Outlook 554 5.2.122 per-hour recipient limit → transient DESPITE the 5xx code', () => {
    const o = classify(
      'fake-outlook',
      '5.2.122 The recipient has exceeded their limit for the number of messages they can receive per hour.',
      554,
    );
    expect(o.kind).toBe('transient');
  });

  it("Yahoo 554 dd user doesn't exist → permanent via text marker", () => {
    const o = classify(
      'fake-yahoo',
      "delivery error: dd This user doesn't have a yahoo.com account (x@yahoo.com)",
      554,
    );
    expect(o.kind).toBe('permanent');
  });

  it('connection dropped without response → transient', () => {
    const o = classify('fake-outlook', null, null);
    expect(o.kind).toBe('transient');
  });
});
