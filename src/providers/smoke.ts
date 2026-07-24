import nodemailer from 'nodemailer';
import './fake-gmail.js';

await new Promise((r) => setTimeout(r, 500));

const t = () =>
  nodemailer.createTransport({
    host: 'localhost',
    port: 2525,
    secure: false,
  });

async function trySend(label: string, to = 'user@fake-gmail.test') {
  try {
    const info = await t().sendMail({
      from: 'rubens@kod.test',
      to,
      subject: 'hi',
      text: 'x',
    });
    console.log(`${label}: ACCEPTED → ${info.response}`);
  } catch (e: any) {
    console.log(`${label}: REJECTED ${e.responseCode} → ${e.response}`);
  }
}

await trySend('1st attempt (expect greylist 421)');
await trySend('2nd attempt immediately (still greylisted)');
console.log('   ...waiting 11s for greylist window...');
await new Promise((r) => setTimeout(r, 11000));
await trySend('3rd attempt after window (expect 250)');
await trySend('hard bounce test', 'unknown99@fake-gmail.test');
process.exit(0);
