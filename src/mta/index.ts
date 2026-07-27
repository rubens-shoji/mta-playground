import amqp from 'amqplib';
import { eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { db } from '../db/client.js';
import { suppressions } from '../db/schema.js';
import {
  EXCHANGE_EVENTS,
  MESSAGE_ID_HEADER,
  type OutboundEmail,
  QUEUE_OUTBOUND,
  QUEUE_RETRY_PREFIX,
  type StatusEvent,
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
 *
 * Persistence is event-driven: every attempt becomes a delivery.attempted
 * event on emails.events; the writer process does the actual DB writes, so
 * the hot path never blocks on Postgres. The suppression list is the one
 * thing read from the DB here, before dialing.
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

const conn = await amqp.connect(AMQP_URL);
const ch = await conn.createChannel();
await ch.assertQueue(QUEUE_OUTBOUND, { durable: true });
await ch.assertExchange(EXCHANGE_EVENTS, 'fanout', { durable: true });
ch.prefetch(5);

function publishEvent(event: StatusEvent) {
  ch.publish(EXCHANGE_EVENTS, '', Buffer.from(JSON.stringify(event)), {
    persistent: true,
  });
}

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

async function isSuppressed(address: string): Promise<boolean> {
  const [row] = await db
    .select({ address: suppressions.address })
    .from(suppressions)
    .where(eq(suppressions.address, address));
  return row !== undefined;
}

ch.consume(QUEUE_OUTBOUND, async (msg) => {
  if (!msg) return;
  const email: OutboundEmail = JSON.parse(msg.content.toString());
  email.attempt += 1;

  const domain = email.to.split('@')[1] ?? '';
  const route = ROUTES[domain];

  if (!route) {
    console.log(`[mta] ${email.id} no route for ${domain} → permanent`);
    publishEvent({
      type: 'delivery.attempted',
      messageId: email.id,
      attempt: email.attempt,
      provider: 'none',
      code: null,
      enhancedCode: null,
      response: `no route for ${domain}`,
      outcome: 'permanent',
      retryInSeconds: null,
      status: 'bounced',
    });
    return ch.ack(msg);
  }
  if (await isSuppressed(email.to)) {
    console.log(`[mta] ${email.id} ${email.to} is suppressed, dropping`);
    publishEvent({ type: 'message.suppressed', messageId: email.id });
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
      headers: { [MESSAGE_ID_HEADER]: email.id },
    });
    raw = info.response;
    code = 250;
  } catch (err: any) {
    raw = err?.response ?? null;
    code = err?.responseCode ?? null;
  }

  const outcome = classify(route.provider, raw, code);
  const tag = `[mta] ${email.id} → ${route.provider} attempt=${email.attempt}`;

  let status: 'deferred' | 'delivered' | 'bounced' = 'deferred';
  let retryInSeconds: number | null = null;

  switch (outcome.kind) {
    case 'delivered':
      status = 'delivered';
      console.log(`${tag} DELIVERED`);
      break;
    case 'permanent':
      status = 'bounced';
      console.log(`${tag} PERMANENT: ${outcome.message}`);
      if (shouldSuppress(outcome)) {
        publishEvent({
          type: 'address.suppressed',
          address: email.to,
          reason: outcome.message,
        });
        console.log(`[mta] suppressed ${email.to}`);
      }
      break;
    case 'transient': {
      const policy = policyFor(route.provider);
      if (email.attempt >= policy.maxAttempts) {
        status = 'bounced';
        console.log(`
          ${tag} GAVE UP after ${email.attempt} attempts: ${outcome.message}`);
        break;
      }
      status = 'deferred';
      retryInSeconds = nextDelaySeconds(policy, email.attempt);
      console.log(
        `${tag} DEFERRED (${outcome.message}) → retry in ${retryInSeconds}s`,
      );
      await scheduleRetry(email, retryInSeconds);
      break;
    }
  }

  publishEvent({
    type: 'delivery.attempted',
    messageId: email.id,
    attempt: email.attempt,
    provider: route.provider,
    code: outcome.code,
    enhancedCode: outcome.enhancedCode,
    response: outcome.message,
    outcome: outcome.kind,
    retryInSeconds,
    status,
  });

  ch.ack(msg);
});

console.log('[mta] consuming', QUEUE_OUTBOUND);
