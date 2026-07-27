import amqp from 'amqplib';
import { EXCHANGE_EVENTS, type StatusEvent } from './types.js';

const AMQP_URL = process.env.AMQP_URL ?? 'amqp://guest:guest@localhost:5672';

/**
 * Connect to RabbitMQ and return a fire-and-forget event publisher on the
 * emails.events fanout exchange. When the broker is unreachable, returns a
 * no-op instead of throwing — providers must keep working standalone
 * (smoke scripts run without RabbitMQ).
 */
export async function eventPublisher(
  name: string,
): Promise<(event: StatusEvent) => void> {
  try {
    const conn = await amqp.connect(AMQP_URL);
    const ch = await conn.createChannel();
    await ch.assertExchange(EXCHANGE_EVENTS, 'fanout', { durable: true });
    console.log(`[${name}] publishing events to ${EXCHANGE_EVENTS}`);
    return (event) => {
      ch.publish(EXCHANGE_EVENTS, '', Buffer.from(JSON.stringify(event)), {
        persistent: true,
      });
    };
  } catch {
    console.log(`[${name}] RabbitMQ unreachable, events disabled`);
    return () => {};
  }
}
