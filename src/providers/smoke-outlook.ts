import net from 'node:net';
import nodemailer from 'nodemailer';

// Low limits so the demo is quick; must be set before the provider loads.
process.env.OUTLOOK_RATE_LIMIT_PER_MIN ??= '3';
process.env.OUTLOOK_MAX_CONNECTIONS ??= '2';
await import('./fake-outlook.js');

await new Promise((r) => setTimeout(r, 500));

const t = () =>
  nodemailer.createTransport({
    host: 'localhost',
    port: 2526,
    secure: false,
  });

async function trySend(
  label: string,
  { from = 'rubens@kod.test', to = 'user@fake-outlook.test' } = {},
) {
  try {
    const info = await t().sendMail({
      from,
      to,
      subject: 'hi',
      text: 'x',
    });
    console.log(`${label}: ACCEPTED → ${info.response}`);
  } catch (e: any) {
    if (e.responseCode) {
      console.log(`${label}: REJECTED ${e.responseCode} → ${e.response}`);
    } else {
      console.log(`${label}: NO RESPONSE → ${e.message}`);
    }
  }
}

/** Open a raw TCP connection and hold it open after the 220 greeting. */
function holdConnection(): Promise<net.Socket> {
  return new Promise((resolve) => {
    const sock = net.connect(2526, 'localhost');
    sock.once('data', () => resolve(sock));
  });
}

await trySend('normal send (expect 250)');
await trySend('mid-session drop (expect no response)', {
  to: 'drop1@fake-outlook.test',
});

const held = [await holdConnection(), await holdConnection()];
await trySend('3rd concurrent connection (expect 421 4.3.2)');
for (const sock of held) sock.destroy();

for (let i = 1; i <= 4; i++) {
  await trySend(`bulk sender msg ${i}/4 (expect 451 4.7.650 on 4th)`, {
    from: 'bulk@kod.test',
  });
}

process.exit(0);
