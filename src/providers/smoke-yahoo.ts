import nodemailer from 'nodemailer';

// Low limits so the demo is quick; must be set before the provider loads.
process.env.YAHOO_DELAY_MS ??= '300';
process.env.YAHOO_RATE_LIMIT_PER_MIN ??= '3';
await import('./fake-yahoo.js');

await new Promise((r) => setTimeout(r, 500));

const t = () =>
  nodemailer.createTransport({
    host: 'localhost',
    port: 2527,
    secure: false,
  });

async function trySend(
  label: string,
  { from = 'rubens@kod.test', to = 'user@fake-yahoo.test' } = {},
) {
  const start = Date.now();
  try {
    const info = await t().sendMail({
      from,
      to,
      subject: 'hi',
      text: 'x',
    });
    console.log(
      `${label}: ACCEPTED in ${Date.now() - start}ms → ${info.response}`,
    );
  } catch (e: any) {
    console.log(
      `${label}: REJECTED ${e.responseCode} in ${Date.now() - start}ms → ${e.response}`,
    );
  }
}

await trySend('normal send (expect 250, slowly)');
await trySend('spammer sender (expect 553 TSS11, permanent by TEXT)', {
  from: 'spammer@kod.test',
});

for (let i = 1; i <= 4; i++) {
  await trySend(`bulk sender msg ${i}/4 (expect 421 TSS04 on 4th)`, {
    from: 'bulk@kod.test',
  });
}

process.exit(0);
