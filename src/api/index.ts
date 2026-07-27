import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import amqp from 'amqplib';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { deliveryAttempts, messages } from '../db/schema.js';
import {
  EXCHANGE_EVENTS,
  type OutboundEmail,
  QUEUE_OUTBOUND,
  type StatusEvent,
} from '../shared/types.js';

/**
 * Control plane: accepts sends, validates, queues. It never talks SMTP —
 * that's the data plane's job (src/mta). A provider slowdown can never
 * block ingestion here; the queue absorbs the spike.
 *
 * Persistence is event-driven: the API publishes message.queued and the
 * writer process does the insert. Reads (GET /messages*) hit Postgres
 * directly — single writer, many readers.
 */

const AMQP_URL = process.env.AMQP_URL ?? 'amqp://guest:guest@localhost:5672';

const conn = await amqp.connect(AMQP_URL);
const ch = await conn.createChannel();
await ch.assertQueue(QUEUE_OUTBOUND, { durable: true });
await ch.assertExchange(EXCHANGE_EVENTS, 'fanout', { durable: true });

function publishEvent(event: StatusEvent) {
  ch.publish(EXCHANGE_EVENTS, '', Buffer.from(JSON.stringify(event)), {
    persistent: true,
  });
}

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));

app.post('/send', async (c) => {
  const body = await c.req.json<Partial<OutboundEmail>>();
  if (!body.from || !body.to) {
    return c.json({ error: 'from and to are required' }, 400);
  }
  const email: OutboundEmail = {
    id: randomUUID(),
    from: body.from,
    to: body.to,
    subject: body.subject ?? '(no subject)',
    body: body.body ?? '',
    attempt: 0,
    queuedAt: new Date().toISOString(),
  };
  publishEvent({ type: 'message.queued', email });
  ch.sendToQueue(QUEUE_OUTBOUND, Buffer.from(JSON.stringify(email)), {
    persistent: true,
  });
  return c.json({ id: email.id, status: 'queued' }, 202);
});

app.get('/messages', async (c) => {
  const rows = await db
    .select({
      id: messages.id,
      from: messages.from,
      to: messages.to,
      status: messages.status,
      queuedAt: messages.queuedAt,
    })
    .from(messages)
    .orderBy(desc(messages.queuedAt))
    .limit(50);
  return c.json(rows);
});

app.get('/messages/:id', async (c) => {
  const id = c.req.param('id');
  const [message] = await db.select().from(messages).where(eq(messages.id, id));
  if (!message) return c.json({ error: 'not found' }, 404);
  const attempts = await db
    .select()
    .from(deliveryAttempts)
    .where(eq(deliveryAttempts.messageId, id))
    .orderBy(deliveryAttempts.attempt);
  return c.json({ ...message, attempts });
});


serve({ fetch: app.fetch, port: 3000 }, () =>
  console.log(
    '[api] listening on :3000 — POST /send, GET /messages[/:id]',
  ),
);
