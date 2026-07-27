import amqp from 'amqplib';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { deliveryAttempts, messages, suppressions } from '../db/schema.js';
import { QUEUE_EVENTS, type StatusEvent } from '../shared/types.js';

/**
 * Writer: the only process that writes to Postgres. Consumes status events
 * from emails.events and maps each one to its insert/update.
 *
 * Ordering: one durable queue, one consumer → FIFO. message.queued is
 * published before the MTA can even receive the outbound message, so an
 * attempt never arrives for a message that hasn't been inserted.
 */

const AMQP_URL = process.env.AMQP_URL ?? 'amqp://guest:guest@localhost:5672';

const conn = await amqp.connect(AMQP_URL);
const ch = await conn.createChannel();
await ch.assertQueue(QUEUE_EVENTS, { durable: true });
ch.prefetch(1);

async function handle(event: StatusEvent) {
  switch (event.type) {
    case 'message.queued': {
      const { email } = event;
      await db
        .insert(messages)
        .values({
          id: email.id,
          from: email.from,
          to: email.to,
          subject: email.subject,
          body: email.body,
          status: 'queued',
          queuedAt: new Date(email.queuedAt),
        })
        .onConflictDoNothing(); // queue redelivery must not double-insert
      console.log(`[writer] ${email.id} queued`);
      break;
    }
    case 'delivery.attempted': {
      await db.insert(deliveryAttempts).values({
        messageId: event.messageId,
        attempt: event.attempt,
        provider: event.provider,
        code: event.code,
        enhancedCode: event.enhancedCode,
        response: event.response,
        outcome: event.outcome,
        retryInSeconds: event.retryInSeconds,
      });
      await db
        .update(messages)
        .set({ status: event.status, updatedAt: new Date() })
        .where(eq(messages.id, event.messageId));
      console.log(
        `[writer] ${event.messageId} attempt=${event.attempt} → ${event.status}`,
      );
      break;
    }
    case 'message.suppressed': {
      await db
        .update(messages)
        .set({ status: 'suppressed', updatedAt: new Date() })
        .where(eq(messages.id, event.messageId));
      console.log(`[writer] ${event.messageId} suppressed`);
      break;
    }
    case 'address.suppressed': {
      await db
        .insert(suppressions)
        .values({ address: event.address, reason: event.reason })
        .onConflictDoNothing();
      console.log(`[writer] suppression list += ${event.address}`);
      break;
    }
  }
}

ch.consume(QUEUE_EVENTS, async (msg) => {
  if (!msg) return;
  try {
    await handle(JSON.parse(msg.content.toString()) as StatusEvent);
    ch.ack(msg);
  } catch (err) {
    console.error('[writer] failed, requeueing:', err);
    ch.nack(msg, false, true);
  }
});

console.log('[writer] consuming', QUEUE_EVENTS);
