import { SMTPServer } from 'smtp-server';
import { eventPublisher } from '../shared/events.js';
import { messageIdFrom } from './placement.js';

/**
 * fake-yahoo — an SMTP server that behaves like Yahoo's edge, using real
 * response strings from Yahoo's sender hub (TSS codes) and the SMTP Field
 * Manual.
 *
 * Behaviors implemented:
 *  1. SLOW RESPONSES: every SMTP step waits YAHOO_DELAY_MS before replying.
 *     Yahoo is famously slow; this exercises the MTA's timeouts.
 *  2. TSS04 VOLUME DEFERRAL: more than YAHOO_RATE_LIMIT_PER_MIN msgs/min
 *     from one sender gets "421 4.7.0 [TSS04] temporarily deferred due to
 *     unexpected volume" — transient, back off and retry.
 *  3. TSS11 PERMANENT-IN-DISGUISE: senders starting with "spammer" get
 *     "553 5.7.2 [TSS11] ... Retrying will NOT succeed." A 553 whose TEXT
 *     is what makes it permanent — and 5.7.x means the SENDER is the
 *     problem, so the recipient must NOT be suppressed.
 *     Try from=spammer@kod.test
 */

const PORT = Number(process.env.YAHOO_PORT ?? 2527);
const DELAY_MS = Number(process.env.YAHOO_DELAY_MS ?? 1500);
const RATE_LIMIT_PER_MIN = Number(process.env.YAHOO_RATE_LIMIT_PER_MIN ?? 20);

const rateWindow = new Map<string, number[]>(); // sender -> timestamps

export const inbox: { from: string; to: string; folder: 'inbox' }[] = [];

const publishEvent = await eventPublisher('fake-yahoo');

const slow = () => new Promise((r) => setTimeout(r, DELAY_MS));

function reply(code: number, text: string) {
  const err = new Error(text) as Error & { responseCode: number };
  err.responseCode = code;
  return err;
}

const server = new SMTPServer({
  disabledCommands: ['AUTH', 'STARTTLS'],
  async onMailFrom(address, session, cb) {
    await slow();
    const sender = address.address;

    // 3. TSS11: permanently deferred, disguised as a 553
    if (sender.startsWith('spammer')) {
      return cb(
        reply(
          553,
          `5.7.2 [TSS11] All messages from ${session.remoteAddress} will be permanently deferred; Retrying will NOT succeed. Please refer to https://postmaster.yahooinc.com/error-codes`,
        ),
      );
    }

    // 2. TSS04: volume deferral per sender
    const now = Date.now();
    const stamps = (rateWindow.get(sender) ?? []).filter(
      (t) => now - t < 60_000,
    );

    stamps.push(now);
    rateWindow.set(sender, stamps);
    if (stamps.length > RATE_LIMIT_PER_MIN) {
      return cb(
        reply(
          421,
          `4.7.0 [TSS04] Messages from ${session.remoteAddress} temporarily deferred due to unexpected volume or user complaints - 4.16.55.1; see https://postmaster.yahooinc.com/error-codes`,
        ),
      );
    }

    cb();
  },
  async onRcptTo(_address, _session, cb) {
    await slow();
    cb();
  },
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => {
      if (chunks.length < 64) chunks.push(c);
    });
    stream.on('end', async () => {
      await slow();
      const from = session.envelope.mailFrom
        ? session.envelope.mailFrom.address
        : '?';
      const messageId = messageIdFrom(chunks);
      for (const rcpt of session.envelope.rcptTo) {
        inbox.push({ from, to: rcpt.address, folder: 'inbox' });
        publishEvent({
          type: 'message.accepted',
          messageId,
          provider: 'fake-yahoo',
          from,
          to: rcpt.address,
          folder: 'inbox',
        });
      }
      console.log(
        `[fake-yahoo] accepted from=${from} (total stored: ${inbox.length})`,
      );
      cb(null, '250 ok dirdel');
    });
  },
});

server.listen(PORT, () => {
  console.log(`[fake-yahoo] listening on :${PORT}`);
  console.log(
    `[fake-yahoo] delay: ${DELAY_MS}ms/step, rate limit: ${RATE_LIMIT_PER_MIN}/min`,
  );
});
