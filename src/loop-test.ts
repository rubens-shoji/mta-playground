/**
 * loop-test — batches infinite random messages at the API so every provider
 * personality shows up on the dashboard: normal deliveries, greylisting,
 * hard bounces (unknown*), outlook mid-session drops (drop*) and yahoo
 * TSS11 (spammer*). Ctrl+C to stop.
 *
 *   pnpm loop-test
 *   LOOP_INTERVAL_MS=200 pnpm loop-test   # flood faster
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const INTERVAL_MS = Number(process.env.LOOP_INTERVAL_MS ?? 800);

const DOMAINS = ['fake-gmail.test', 'fake-outlook.test', 'fake-yahoo.test'];
const SENDERS = [
  'rubens@kod.test',
  'ana@kod.test',
  'newsletter@kod.test',
  'bulk@kod.test',
];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function randomEmail(): { from: string; to: string; subject: string } {
  const domain = pick(DOMAINS);
  const roll = Math.random();

  // 10% hard bounce, 10% provider-specific nastiness, 80% normal
  let local = `user${Math.ceil(Math.random() * 5)}`;
  let from = pick(SENDERS);
  if (roll < 0.1) {
    local = `unknown${Math.ceil(Math.random() * 99)}`;
  } else if (roll < 0.2 && domain === 'fake-outlook.test') {
    local = `drop${Math.ceil(Math.random() * 9)}`;
  } else if (roll < 0.2 && domain === 'fake-yahoo.test') {
    from = 'spammer@kod.test';
  }

  return {
    from,
    to: `${local}@${domain}`,
    subject: `loop-test #${counter}`,
  };
}

let counter = 0;

async function send() {
  counter += 1;
  const email = randomEmail();
  try {
    const res = await fetch(`${API_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(email),
    });
    const body = (await res.json()) as { id?: string };
    console.log(
      `[loop-test] #${counter} ${email.from} → ${email.to} (${body.id ?? res.status})`,
    );
  } catch {
    console.log(
      `[loop-test] #${counter} API unreachable at ${API_URL}, retrying…`,
    );
  }
}

console.log(
  `[loop-test] sending forever to ${API_URL} every ~${INTERVAL_MS}ms — Ctrl+C to stop`,
);
for (;;) {
  await send();
  // jittered interval so retries and rate limits interleave naturally
  await new Promise((r) =>
    setTimeout(r, INTERVAL_MS / 2 + Math.random() * INTERVAL_MS),
  );
}
