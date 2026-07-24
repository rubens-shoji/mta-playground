import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import amqp from 'amqplib';
import { Hono } from 'hono';
import { type OutboundEmail, QUEUE_OUTBOUND } from '../shared/types.js';

/**
 * Control plane: accepts sends, validates, queues. It never talks SMTP —
 * that's the data plane's job (src/mta). A provider slowdown can never
 * block ingestion here; the queue absorbs the spike.
 */

const AMQP_URL = process.env.AMQP_URL ?? 'amqp://guest:guest@localhost:5672';

const conn = await amqp.connect(AMQP_URL);
const ch = await conn.createChannel();
await ch.assertQueue(QUEUE_OUTBOUND, { durable: true });

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
  ch.sendToQueue(QUEUE_OUTBOUND, Buffer.from(JSON.stringify(email)), {
    persistent: true,
  });
  return c.json({ id: email.id, status: 'queued' }, 202);
});

serve({ fetch: app.fetch, port: 3000 }, () =>
  console.log('[api] listening on :3000 — POST /send'),
);
