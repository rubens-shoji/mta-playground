import { SMTPServer } from 'smtp-server';
import { eventPublisher } from '../shared/events.js';
import { messageIdFrom } from './placement.js';

/**
 * fake-gmail — an SMTP server that behaves like Gmail's edge, using real
 * response strings from Google's official error table and the SMTP Field
 * Manual. Every response ends with "- gsmtp", like the real thing.
 *
 * Behaviors implemented:
 *  1. GREYLISTING: first contact from an unknown sender IP+from pair gets
 *     "421 4.7.0 Try again later" — a retry after GREYLIST_SECONDS passes.
 *  2. RATE LIMITING: more than RATE_LIMIT msgs/min from one sender earns
 *     the famous "421 4.7.28 unusual rate of unsolicited mail".
 *  3. HARD BOUNCE: any recipient starting with "unknown" doesn't exist
 *     ("550 5.1.1"). Try to=unknown1@fake-gmail.test
 *  4. SPAM FOLDER: accepted mail (250) still lands in "spam" if the sender
 *     has been rate-limited recently — accepted ≠ inbox placement.
 */

const PORT = Number(process.env.GMAIL_PORT ?? 2525);
const GREYLIST_SECONDS = Number(process.env.GREYLIST_SECONDS ?? 10);
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 20);

const greylist = new Map<string, number>(); // key -> first-seen epoch ms
const rateWindow = new Map<string, number[]>(); // sender -> timestamps
const recentlyLimited = new Set<string>();

export const inbox: { from: string; to: string; folder: 'inbox' | 'spam' }[] =
  [];

const publishEvent = await eventPublisher('fake-gmail');

function gsmtp(code: number, text: string) {
  const err = new Error(`${text} - gsmtp`) as Error & { responseCode: number };
  err.responseCode = code;
  return err;
}

const server = new SMTPServer({
  disabledCommands: ['AUTH', 'STARTTLS'],
  onMailFrom(address, session, cb) {
    const sender = address.address;
    const key = `${session.remoteAddress}|${sender}`;

    // 1. Greylisting
    const firstSeen = greylist.get(key);
    if (firstSeen === undefined) {
      greylist.set(key, Date.now());
      return cb(gsmtp(421, '4.7.0 Try again later, closing connection.'));
    }
    if (Date.now() - firstSeen < GREYLIST_SECONDS * 1000) {
      return cb(gsmtp(421, '4.7.0 Try again later, closing connection.'));
    }

    // 2. Rate limiting per sender
    const now = Date.now();
    const stamps = (rateWindow.get(sender) ?? []).filter(
      (t) => now - t < 60_000,
    );

    stamps.push(now);
    rateWindow.set(sender, stamps);
    if (stamps.length > RATE_LIMIT_PER_MIN) {
      recentlyLimited.add(sender);
      return cb(
        gsmtp(
          421,
          `4.7.28 [${session.remoteAddress}] Our system has detected an unusual rate of unsolicited mail originating from your IP address. To protect our users from spam, mail sent from your IP address has been temporarily rate limited.`,
        ),
      );
    }

    cb();
  },
  onRcptTo(address, _session, cb) {
    // 3. Hard bounce for unknown users
    if (address.address.startsWith('unknown')) {
      return cb(
        gsmtp(
          550,
          '5.1.1 The email account that you tried to reach does not exist.',
        ),
      );
    }
    cb();
  },
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => {
      if (chunks.length < 64) chunks.push(c);
    });
    stream.on('end', () => {
      const from = session.envelope.mailFrom
        ? session.envelope.mailFrom.address
        : '?';
      const messageId = messageIdFrom(chunks);
      // 4. Accepted but possibly spam-foldered
      const folder = recentlyLimited.has(from) ? 'spam' : 'inbox';
      for (const rcpt of session.envelope.rcptTo) {
        inbox.push({ from, to: rcpt.address, folder });
        publishEvent({
          type: 'message.accepted',
          messageId,
          provider: 'fake-gmail',
          from,
          to: rcpt.address,
          folder,
        });
      }
      console.log(
        `[fake-gmail] accepted from=${from} → ${folder} (total stored: ${inbox.length})`,
      );
      cb(null, 'OK 250 2.0.0 - gsmtp');
    });
  },
});

server.listen(PORT, () => {
  console.log(`[fake-gmail] listening on :${PORT}`);
  console.log(
    `[fake-gmail] greylist window: ${GREYLIST_SECONDS}s, rate limit: ${RATE_LIMIT_PER_MIN}/min`,
  );
});
