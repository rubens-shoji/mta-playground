import amqp from 'amqplib';
import nodemailer from 'nodemailer';
import {
  type OutboundEmail,
  QUEUE_OUTBOUND,
  QUEUE_RETRY_PREFIX,
} from '../shared/types.js';
import { classify, shouldSuppress } from './classifier.js';
import { nextDelaySeconds, policyFor } from './retry.js';

/**
 * Data plane: consumes the outbound queue, routes by recipient domain,
 * speaks SMTP to the destination provider, classifies the response, and
 * schedules retries with per-provider backoff.
 *
 * Retries use RabbitMQ dead-letter TTL queues: a deferred message is
 * published to a per-delay retry queue whose only consumer is time itself —
 * when the TTL expires, RabbitMQ dead-letters it back into the outbound
 * queue. No sleeping workers, no polling.
 */

const AMQP_URL = process.env.AMQP_URL ?? 'amqp://guest:guest@localhost:5672';

/** Recipient domain → provider. In real life this is an MX lookup. */
const ROUTES: Record<string, { provider: string; host: string; port: number }> =
  {
    'fake-gmail.test': {
      provider: 'fake-gmail',
      host: 'localhost',
      port: 2525,
    },
    'fake-outlook.test': {
      provider: 'fake-outlook',
      host: 'localhost',
      port: 2526,
    },
    'fake-yahoo.test': {
      provider: 'fake-yahoo',
      host: 'localhost',
      port: 2527,
    },
  };

const suppression = new Set<string>();

const conn = await amqp.connect(AMQP_URL);
const ch = await conn.createChannel();
await ch.assertQueue(QUEUE_OUTBOUND, { durable: true });
ch.prefetch(5);

async function scheduleRetry(email: OutboundEmail, delaySeconds: number) {
  const queue = `${QUEUE_RETRY_PREFIX}${delaySeconds}s`;
  await ch.assertQueue(queue, {
    durable: true,
    messageTtl: delaySeconds * 1000,
    deadLetterExchange: '',
    deadLetterRoutingKey: QUEUE_OUTBOUND,
  });
  ch.sendToQueue(queue, Buffer.from(JSON.stringify(email)), {
    persistent: true,
  });
}

ch.consume(QUEUE_OUTBOUND, async (msg) => {
  if (!msg) return;
  const email: OutboundEmail = JSON.parse(msg.content.toString());
  email.attempt += 1;

  const domain = email.to.split('@')[1] ?? '';
  const route = ROUTES[domain];

  if (!route) {
    console.log(`[mta] ${email.id} no route for ${domain} → permanent`);
    return ch.ack(msg);
  }
  if (suppression.has(email.to)) {
    console.log(`[mta] ${email.id} ${email.to} is suppressed, dropping`);
    return ch.ack(msg);
  }

  const transporter = nodemailer.createTransport({
    host: route.host,
    port: route.port,
    secure: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 5000,
  });

  let raw: string | null = null;
  let code: number | null = null;
  try {
    const info = await transporter.sendMail({
      from: email.from,
      to: email.to,
      subject: email.subject,
      text: email.body,
    });
    raw = info.response;
    code = 250;
  } catch (err: any) {
    raw = err?.response ?? null;
    code = err?.responseCode ?? null;
  }

  const outcome = classify(route.provider, raw, code);
  const tag = `[mta] ${email.id} → ${route.provider} attempt=${email.attempt}`;

  switch (outcome.kind) {
    case 'delivered':
      console.log(`${tag} DELIVERED`);
      break;
    case 'permanent':
      console.log(`${tag} PERMANENT: ${outcome.message}`);
      if (shouldSuppress(outcome)) {
        suppression.add(email.to);
        console.log(`[mta] suppressed ${email.to}`);
      }
      break;
    case 'transient': {
      const policy = policyFor(route.provider);
      if (email.attempt >= policy.maxAttempts) {
        console.log(`
          ${tag} GAVE UP after ${email.attempt} attempts: ${outcome.message}`);
        break;
      }
      const delay = nextDelaySeconds(policy, email.attempt);
      console.log(`${tag} DEFERRED (${outcome.message}) → retry in ${delay}s`);
      await scheduleRetry(email, delay);
      break;
    }
  }

  ch.ack(msg);
});

console.log('[mta] consuming', QUEUE_OUTBOUND);
