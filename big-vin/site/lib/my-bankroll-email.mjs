/** My Bankroll OTP email. Karma link matches SITE_CONFIG.donation.href / Boost Cash App. */
export const KARMA_URL = 'https://cash.app/$bigvinsports';

/** Build subject + text for the sign-in code email (also used in tests). */
export function buildOtpEmail({ code, karmaUrl = KARMA_URL }) {
  const subject = `${code} is your Big Vin code — go have fun`;
  const text = [
    `Hey — your Big Vin My Bankroll code is:`,
    ``,
    `    ${code}`,
    ``,
    `It expires in 15 minutes. Punch it in, then follow Vin’s plays for the fun of it.`,
    ``,
    `This is entertainment only — not financial advice. Bet what you can laugh about either way.`,
    ``,
    `Like what we’re building? Boost your karma and support the project:`,
    karmaUrl,
    ``,
    `If you didn’t ask for this code, you can ignore this email.`,
    ``,
    `— Big Vin`,
  ].join('\n');
  return { subject, text, karmaUrl };
}

/** Send My Bankroll OTP via Resend when RESEND_API_KEY is set. */
export async function sendOtpEmail({ to, code, from, apiKey, karmaUrl = KARMA_URL }) {
  if (!apiKey) return { sent: false, reason: 'missing-key' };
  const sender = from || 'Big Vin <onboarding@resend.dev>';
  const { subject, text } = buildOtpEmail({ code, karmaUrl });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: sender, to: [to], subject, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Resend send failed', res.status, body.slice(0, 300));
    return { sent: false, reason: 'send-failed', status: res.status };
  }
  return { sent: true };
}
