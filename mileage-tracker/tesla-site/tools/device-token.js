#!/usr/bin/env node
// Issue a device token for the iPhone app. Run locally with the same SESSION_SECRET as the Vercel project:
//   SESSION_SECRET=... node tools/device-token.js john@ovanova.co "John"
// Paste the printed token into the app's Settings screen. Valid for one year; rotate SESSION_SECRET to revoke all.
const { sign } = require('../lib/session');
const { allowedEmail } = require('../lib/service');
const [email, name] = process.argv.slice(2);
if (!process.env.SESSION_SECRET) { console.error('Set SESSION_SECRET'); process.exit(1); }
if (!allowedEmail(email || '')) { console.error('Usage: device-token.js name@ovanova.co [Display Name]'); process.exit(1); }
console.log(sign({ k: 'device', e: email.toLowerCase(), n: name || undefined }, process.env.SESSION_SECRET, 365 * 86400));
