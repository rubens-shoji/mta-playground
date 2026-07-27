import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import amqp from 'amqplib';
import { count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '../db/client.js';
import { deliveryAttempts, messages, placements } from '../db/schema.js';
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


/** Queue depths from the RabbitMQ management API — retry queues come and
 *  go dynamically, so we ask the broker instead of hardcoding names. */
const MGMT_URL = process.env.RABBITMQ_MGMT_URL ?? 'http://localhost:15672';

async function queueDepths(): Promise<{ name: string; messages: number }[]> {
  try {
    const { username, password } = new URL(AMQP_URL);
    const auth = Buffer.from(
      `${decodeURIComponent(username) || 'guest'}:${decodeURIComponent(password) || 'guest'}`,
    ).toString('base64');
    const res = await fetch(`${MGMT_URL}/api/queues`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return [];
    const all = (await res.json()) as { name: string; messages: number }[];
    return all
      .filter((q) => q.name.startsWith('emails.'))
      .map((q) => ({ name: q.name, messages: q.messages }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

app.get('/stats', async (c) => {
  const statuses = await db
    .select({ status: messages.status, count: count() })
    .from(messages)
    .groupBy(messages.status);
  const placementCounts = await db
    .select({
      provider: placements.provider,
      folder: placements.folder,
      count: count(),
    })
    .from(placements)
    .groupBy(placements.provider, placements.folder);
  return c.json({
    statuses,
    placements: placementCounts,
    queues: await queueDepths(),
  });
});

/** Live relay of the event stream: each SSE client gets its own exclusive
 *  auto-delete queue bound to the fanout exchange — the writer's durable
 *  queue is untouched, dashboards just tap the same stream. */
app.get('/events', (c) =>
  streamSSE(c, async (stream) => {
    const sseCh = await conn.createChannel();
    const { queue } = await sseCh.assertQueue('', {
      exclusive: true,
      autoDelete: true,
    });
    await sseCh.bindQueue(queue, EXCHANGE_EVENTS, '');

    let open = true;
    stream.onAbort(() => {
      open = false;
    });

    await sseCh.consume(queue, (msg) => {
      if (!msg) return;
      stream.writeSSE({ data: msg.content.toString() });
      sseCh.ack(msg);
    });

    while (open) {
      await stream.writeSSE({ event: 'ping', data: '' });
      await stream.sleep(15_000);
    }
    await sseCh.close();
  }),
);

serve({ fetch: app.fetch, port: 3000 }, () =>
  console.log(
    '[api] listening on :3000 — POST /send, GET /messages[/:id], /stats, /events (SSE)',
  ),
);
