import { SMTPServer } from 'smtp-server';
import { eventPublisher } from '../shared/events.js';
import { messageIdFrom } from './placement.js';

/**
 * fake-outlook — an SMTP server that behaves like Outlook.com's edge, using
 * real response strings from the SMTP Field Manual and postmaster.live.com.
 *
 * Behaviors implemented:
 *  1. CONNECTION LIMIT: Outlook allows few concurrent connections per source
 *     IP. Above OUTLOOK_MAX_CONNECTIONS active connections, new ones get
 *     "421 4.3.2 ... closing transmission channel".
 *  2. REPUTATION RATE LIMIT: more than OUTLOOK_RATE_LIMIT_PER_MIN msgs/min
 *     from one sender earns "451 4.7.650 temporarily rate limited due to IP
 *     reputation (S775)".
 *  3. MID-SESSION DROP: any recipient starting with "drop" gets the TCP
 *     connection destroyed during DATA, with no SMTP response at all. The
 *     classifier treats the missing response as transient, so the MTA
 *     retries until the policy gives up. Try to=drop1@fake-outlook.test
 */

const PORT = Number(process.env.OUTLOOK_PORT ?? 2526);
const MAX_CONNECTIONS = Number(process.env.OUTLOOK_MAX_CONNECTIONS ?? 2);
const RATE_LIMIT_PER_MIN = Number(process.env.OUTLOOK_RATE_LIMIT_PER_MIN ?? 20);

const active = new Set<string>(); // session ids of accepted connections
const rateWindow = new Map<string, number[]>(); // sender -> timestamps

export const inbox: { from: string; to: string; folder: 'inbox' }[] = [];

const publishEvent = await eventPublisher('fake-outlook');

function reply(code: number, text: string) {
  const err = new Error(text) as Error & { responseCode: number };
  err.responseCode = code;
  return err;
}

/** smtp-server doesn't expose the socket on the session object, so reach
 *  into the server's connection set to kill the TCP stream directly. */
function destroySocket(session: { id: string }) {
  const conns = (
    server as unknown as {
      connections: Set<{
        session: { id: string };
        _socket: { destroy(): void };
      }>;
    }
  ).connections;
  for (const conn of conns) {
    if (conn.session.id === session.id) conn._socket.destroy();
  }
}

const server = new SMTPServer({
  disabledCommands: ['AUTH', 'STARTTLS'],
  onConnect(session, cb) {
    // 1. Concurrent connection limit
    if (active.size >= MAX_CONNECTIONS) {
      return cb(
        reply(
          421,
          '4.3.2 The maximum number of concurrent server connections has exceeded a per-source limit, closing transmission channel',
        ),
      );
    }
    active.add(session.id);
    cb();
  },
  onClose(session) {
    active.delete(session.id);
  },
  onMailFrom(address, session, cb) {
    const sender = address.address;

    // 2. Reputation rate limit per sender
    const now = Date.now();
    const stamps = (rateWindow.get(sender) ?? []).filter(
      (t) => now - t < 60_000,
    );

    stamps.push(now);
    rateWindow.set(sender, stamps);
    if (stamps.length > RATE_LIMIT_PER_MIN) {
      return cb(
        reply(
          451,
          `4.7.650 The mail server [${session.remoteAddress}] has been temporarily rate limited due to IP reputation. For e-mail delivery information, see https://postmaster.live.com (S775)`,
        ),
      );
    }

    cb();
  },
  onData(stream, session, cb) {
    // 3. Mid-session drop: die during DATA, no response
    if (session.envelope.rcptTo.some((r) => r.address.startsWith('drop'))) {
      console.log(
        `[fake-outlook] dropping connection mid-DATA (rcpt starts with "drop")`,
      );
      return destroySocket(session);
    }

    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => {
      if (chunks.length < 64) chunks.push(c);
    });
    stream.on('end', () => {
      const from = session.envelope.mailFrom
        ? session.envelope.mailFrom.address
        : '?';
      const messageId = messageIdFrom(chunks);
      for (const rcpt of session.envelope.rcptTo) {
        inbox.push({ from, to: rcpt.address, folder: 'inbox' });
        publishEvent({
          type: 'message.accepted',
          messageId,
          provider: 'fake-outlook',
          from,
          to: rcpt.address,
          folder: 'inbox',
        });
      }
      console.log(
        `[fake-outlook] accepted from=${from} (total stored: ${inbox.length})`,
      );
      cb(null, '250 2.6.0 Queued mail for delivery');
    });
  },
});

server.listen(PORT, () => {
  console.log(`[fake-outlook] listening on :${PORT}`);
  console.log(
    `[fake-outlook] max connections: ${MAX_CONNECTIONS}, rate limit: ${RATE_LIMIT_PER_MIN}/min`,
  );
});
